// IndexedDB copy of the deck and the answers, used to keep studying while offline.
// The memory version backs the tests.

import { z } from 'zod'

import { deckCardSchema, type DeckCard, type SyncResponse } from './contract'
import { localEventSchema, mergeSync, sendOrder, type LocalEvent } from './local-copy'

export type LocalStatus = {
  deckVersion: string | null

  pending: number
}

export type StoredCopy = {
  deck: { version: string; cards: DeckCard[] } | null
  events: LocalEvent[]
  quarantined: string[]
}

export type LocalStore = {
  status(): Promise<LocalStatus>
  read(): Promise<StoredCopy>

  add(event: LocalEvent): Promise<void>

  pending(): Promise<LocalEvent[]>

  markSent(id: string, at: number): Promise<void>

  drop(id: string): Promise<void>

  quarantine(itemId: string): Promise<void>

  replace(sync: SyncResponse, requestedAt: number): Promise<void>

  clear(since: number): Promise<void>
}

const stateSchema = z.object({
  key: z.literal('state'),
  deckVersion: z.string().nullable(),
  quarantined: z.array(z.string()),
})
type StateRecord = z.infer<typeof stateSchema>
const deckSchema = z.object({
  key: z.literal('deck'),
  version: z.string(),
  cards: z.array(deckCardSchema),
})

const EMPTY_STATE: StateRecord = { key: 'state', deckVersion: null, quarantined: [] }

function withQuarantined(state: StateRecord, itemId: string): StateRecord {
  return state.quarantined.includes(itemId)
    ? state
    : { ...state, quarantined: [...state.quarantined, itemId] }
}

export function memoryLocalStore(): LocalStore & { events: Map<string, LocalEvent> } {
  const events = new Map<string, LocalEvent>()
  let state: StateRecord = EMPTY_STATE
  let deck: StoredCopy['deck'] = null
  const pendingList = () => [...events.values()].filter((e) => e.pending === 1).toSorted(sendOrder)
  return {
    events,
    status: () =>
      Promise.resolve({ deckVersion: state.deckVersion, pending: pendingList().length }),
    read: () =>
      Promise.resolve({
        deck,
        events: [...events.values()].toSorted(sendOrder),
        quarantined: state.quarantined,
      }),
    add(event) {
      if (!events.has(event.id)) events.set(event.id, event)
      return Promise.resolve()
    },
    pending: () => Promise.resolve(pendingList()),
    markSent(id, at) {
      const known = events.get(id)
      if (known) events.set(id, { ...known, pending: 0, sentAt: at })
      return Promise.resolve()
    },
    drop(id) {
      events.delete(id)
      return Promise.resolve()
    },
    quarantine(itemId) {
      state = withQuarantined(state, itemId)
      return Promise.resolve()
    },
    replace(sync, requestedAt) {
      for (const event of mergeSync([...events.values()], sync.events, requestedAt)) {
        events.set(event.id, event)
      }
      if (sync.deck) deck = { version: sync.deckVersion, cards: sync.deck }
      state = { key: 'state', deckVersion: deck?.version ?? null, quarantined: sync.quarantined }
      return Promise.resolve()
    },
    clear(since) {
      for (const [id, event] of events) if (event.seq < since) events.delete(id)
      state = { ...state, quarantined: [] }
      return Promise.resolve()
    },
  }
}

export const LOCAL_DB_NAME = 'coach-study'
const LOCAL_DB_VERSION = 1
const EVENTS = 'events'
const META = 'meta'

function requestResult(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const result: unknown = request.result
      resolve(result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'))
    }
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve()
    }
    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'))
    }
    tx.onabort = () => {
      reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    }
  })
}

function parseEvents(value: unknown): LocalEvent[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry: unknown) => {
    const parsed = localEventSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

function idOf(record: unknown): unknown {
  return typeof record === 'object' && record !== null && 'id' in record ? record.id : undefined
}

function parseState(value: unknown): StateRecord {
  const parsed = stateSchema.safeParse(value)
  return parsed.success ? parsed.data : EMPTY_STATE
}

export function indexedDbLocalStore(factory: IDBFactory, name = LOCAL_DB_NAME): LocalStore {
  let opening: Promise<IDBDatabase> | null = null

  let deckCache: { version: string; cards: DeckCard[] } | null = null

  function open(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, LOCAL_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(EVENTS)) {
          db.createObjectStore(EVENTS, { keyPath: 'id' }).createIndex('pending', 'pending')
        }
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
      }
      request.onsuccess = () => {
        const db = request.result

        db.onversionchange = () => {
          db.close()
          opening = null
        }
        db.onclose = () => {
          opening = null
        }
        resolve(db)
      }
      request.onerror = () => {
        opening = null
        reject(request.error ?? new Error('IndexedDB open failed'))
      }
    })
    return opening
  }

  function forget(): void {
    const stale = opening
    opening = null
    void stale?.then(
      (db) => {
        db.close()
      },
      () => undefined,
    )
  }

  async function run<T>(
    stores: string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      const db = await open()
      return await work(db.transaction(stores, mode))
    } catch (error) {
      forget()
      throw error
    }
  }

  async function readCopy(tx: IDBTransaction): Promise<StoredCopy> {
    const meta = tx.objectStore(META)
    const done = transactionDone(tx)
    let events: unknown = []
    let state = EMPTY_STATE
    let deckValue: unknown = null
    const all = tx.objectStore(EVENTS).getAll()
    all.onsuccess = () => {
      events = all.result
    }
    const stateRequest = meta.get('state')
    stateRequest.onsuccess = () => {
      state = parseState(stateRequest.result)
      if (state.deckVersion === null || deckCache?.version === state.deckVersion) return
      const deckRequest = meta.get('deck')
      deckRequest.onsuccess = () => {
        deckValue = deckRequest.result
      }
    }
    await done
    if (state.deckVersion !== null && deckCache?.version !== state.deckVersion) {
      const parsed = deckSchema.safeParse(deckValue)
      if (parsed.success && parsed.data.version === state.deckVersion) {
        deckCache = { version: parsed.data.version, cards: parsed.data.cards }
      }
    }
    return {
      deck: deckCache?.version === state.deckVersion ? deckCache : null,
      events: parseEvents(events).toSorted(sendOrder),
      quarantined: state.quarantined,
    }
  }

  return {
    status: () =>
      run([EVENTS, META], 'readonly', async (tx) => {
        const [pending, state] = await Promise.all([
          requestResult(tx.objectStore(EVENTS).index('pending').count(1)),
          requestResult(tx.objectStore(META).get('state')),
        ])
        return {
          deckVersion: parseState(state).deckVersion,
          pending: typeof pending === 'number' ? pending : 0,
        }
      }),

    read: () => run([EVENTS, META], 'readonly', readCopy),

    add: (event) =>
      run([EVENTS], 'readwrite', async (tx) => {
        const store = tx.objectStore(EVENTS)
        const done = transactionDone(tx)
        const get = store.get(event.id)
        get.onsuccess = () => {
          if (get.result === undefined) store.add(event)
        }
        await done
      }),

    pending: () =>
      run([EVENTS], 'readonly', async (tx) => {
        const records = await requestResult(tx.objectStore(EVENTS).index('pending').getAll(1))
        return parseEvents(records).toSorted(sendOrder)
      }),

    markSent: (id, at) =>
      run([EVENTS], 'readwrite', async (tx) => {
        const store = tx.objectStore(EVENTS)
        const done = transactionDone(tx)
        const get = store.get(id)
        get.onsuccess = () => {
          const parsed = localEventSchema.safeParse(get.result)
          if (parsed.success) store.put({ ...parsed.data, pending: 0, sentAt: at })
        }
        await done
      }),

    drop: (id) =>
      run([EVENTS], 'readwrite', async (tx) => {
        const done = transactionDone(tx)
        tx.objectStore(EVENTS).delete(id)
        await done
      }),

    quarantine: (itemId) =>
      run([META], 'readwrite', async (tx) => {
        const store = tx.objectStore(META)
        const done = transactionDone(tx)
        const get = store.get('state')
        get.onsuccess = () => {
          store.put(withQuarantined(parseState(get.result), itemId))
        }
        await done
      }),

    replace: (sync, requestedAt) =>
      run([EVENTS, META], 'readwrite', async (tx) => {
        const events = tx.objectStore(EVENTS)
        const meta = tx.objectStore(META)
        const done = transactionDone(tx)
        const all = events.getAll()
        all.onsuccess = () => {
          for (const event of mergeSync(parseEvents(all.result), sync.events, requestedAt)) {
            events.put(event)
          }
        }
        const state = meta.get('state')
        state.onsuccess = () => {
          const known = parseState(state.result)
          if (sync.deck) meta.put({ key: 'deck', version: sync.deckVersion, cards: sync.deck })
          meta.put({
            key: 'state',
            deckVersion: sync.deck ? sync.deckVersion : known.deckVersion,
            quarantined: sync.quarantined,
          })
        }
        await done
        if (sync.deck) deckCache = { version: sync.deckVersion, cards: sync.deck }
      }),

    clear: (since) =>
      run([EVENTS, META], 'readwrite', async (tx) => {
        const events = tx.objectStore(EVENTS)
        const meta = tx.objectStore(META)
        const done = transactionDone(tx)
        const all = events.getAll()
        all.onsuccess = () => {
          const records: unknown = all.result
          if (!Array.isArray(records)) return
          for (const record of records) {
            const parsed = localEventSchema.safeParse(record)
            if (parsed.success && parsed.data.seq >= since) continue
            const id: unknown = parsed.success ? parsed.data.id : idOf(record)
            if (typeof id === 'string') events.delete(id)
          }
        }
        const state = meta.get('state')
        state.onsuccess = () => {
          meta.put({ ...parseState(state.result), quarantined: [] })
        }
        await done
      }),
  }
}
