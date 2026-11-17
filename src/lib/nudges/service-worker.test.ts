import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8')
const ORIGIN = 'https://coach-study.example'

type Listener = (event: unknown) => void
type Shown = { title: string; options: Record<string, unknown> }

function load(windows: object[] = []) {
  const listeners = new Map<string, Listener>()
  const shown: Shown[] = []
  const opened: string[] = []
  const calls: string[] = []
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: () => {
      calls.push('skipWaiting')
      return Promise.resolve()
    },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options })
        return Promise.resolve()
      },
    },
    clients: {
      claim: () => {
        calls.push('claim')
        return Promise.resolve()
      },
      matchAll: () => Promise.resolve(windows),
      openWindow: (url: string) => {
        opened.push(url)
        return Promise.resolve(null)
      },
    },
  }
  runInNewContext(SOURCE, { self, URL })

  async function dispatch(type: string, event: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = []
    const listener = listeners.get(type)
    if (!listener) throw new Error(`no ${type} listener`)
    listener({ ...event, waitUntil: (promise: Promise<unknown>) => waits.push(promise) })
    await Promise.all(waits)
  }
  return { listeners, shown, opened, calls, dispatch }
}

const pushData = (value: unknown) => ({
  json: (): unknown => (typeof value === 'string' ? (JSON.parse(value) as unknown) : value),
})

describe('the service worker (public/sw.js)', () => {
  it('only shows reminders and opens the app: it never handles a request', () => {
    const sw = load()
    expect([...sw.listeners.keys()].sort()).toEqual([
      'activate',
      'install',
      'notificationclick',
      'push',
    ])
  })

  it('takes over at once when installed', async () => {
    const sw = load()
    await sw.dispatch('install')
    await sw.dispatch('activate')
    expect(sw.calls).toEqual(['skipWaiting', 'claim'])
  })

  it('shows the reminder the server sent', async () => {
    const sw = load()
    const message = {
      title: 'Two days to practice day.',
      body: '40 cards for today. Start when you’re ready.',
      url: '/',
      tag: 'coach-study-reminder',
    }
    await sw.dispatch('push', { data: pushData(message) })
    expect(sw.shown).toEqual([
      {
        title: message.title,
        options: {
          body: message.body,
          tag: message.tag,
          icon: '/icon.png',
          data: { url: '/' },
        },
      },
    ])
  })

  it('always shows something, even when the message can’t be read (iPadOS requires it)', async () => {
    for (const data of [null, pushData('not json'), pushData(42), pushData({ title: 7 })]) {
      const sw = load()
      await sw.dispatch('push', { data })
      expect(sw.shown).toEqual([
        {
          title: 'Coach Study',
          options: {
            body: 'Start when you’re ready.',
            tag: 'coach-study-reminder',
            icon: '/icon.png',
            data: { url: '/' },
          },
        },
      ])
    }
  })

  it('never sends them to another site from a reminder', async () => {
    for (const url of ['https://example.com/', '//example.com/x', 'javascript:alert(1)', 5]) {
      const sw = load()
      await sw.dispatch('push', { data: pushData({ title: 'T', body: 'B', url }) })
      expect(sw.shown[0]?.options.data).toEqual({ url: '/' })
    }
  })

  function appWindow(url: string, navigate: 'works' | 'refused' = 'works') {
    const done: string[] = []
    const client = {
      url,
      focus: () => {
        done.push('focus')
        return Promise.resolve(client)
      },
      navigate: (to: string) => {
        done.push(`navigate ${to}`)
        return navigate === 'works'
          ? Promise.resolve({ ...client, url: to })
          : Promise.reject(new TypeError('not controlled'))
      },
    }
    return { client, done }
  }

  it('brings the open app forward on a tap and moves it to Home, where Start is', async () => {
    const open = appWindow(`${ORIGIN}/progress`)
    const sw = load([open.client])
    let closed = false
    await sw.dispatch('notificationclick', {
      notification: {
        data: { url: '/' },
        close: () => {
          closed = true
        },
      },
    })
    expect(closed).toBe(true)
    expect(open.done).toEqual(['focus', `navigate ${ORIGIN}/`])
    expect(sw.opened).toEqual([])
  })

  it('only brings the app forward when it is already on Home, or can’t be moved', async () => {
    const home = appWindow(`${ORIGIN}/`)
    await load([home.client]).dispatch('notificationclick', {
      notification: { data: { url: '/' }, close: () => undefined },
    })
    expect(home.done).toEqual(['focus'])
    const stuck = appWindow(`${ORIGIN}/progress`, 'refused')
    await load([stuck.client]).dispatch('notificationclick', {
      notification: { data: { url: '/' }, close: () => undefined },
    })
    expect(stuck.done).toEqual(['focus', `navigate ${ORIGIN}/`])
  })

  it('opens the app at Home on a tap when it isn’t open', async () => {
    const sw = load()
    await sw.dispatch('notificationclick', {
      notification: { data: { url: '/' }, close: () => undefined },
    })
    expect(sw.opened).toEqual([`${ORIGIN}/`])
    const elsewhere = load()
    await elsewhere.dispatch('notificationclick', {
      notification: { data: { url: 'https://example.com/' }, close: () => undefined },
    })
    expect(elsewhere.opened).toEqual([`${ORIGIN}/`])
  })
})
