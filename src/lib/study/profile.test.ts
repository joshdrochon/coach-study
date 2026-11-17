import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { openTestDb, type Db } from '../db/client'
import { profile } from '../db/schema'
import { at, DAY, photoVersion, T0 } from '@/test/study-fixtures'

import {
  avatarUrl,
  avatarVersion,
  profileChangeSchema,
  readProfile,
  updateProfile,
  type ProfileChange,
} from './profile'

const PHOTO = Buffer.from('a jpeg, as far as this test is concerned').toString('base64')
const OTHER_PHOTO = Buffer.from('another jpeg').toString('base64')

let db: Db
beforeEach(async () => {
  db = await openTestDb()
})

function change(input: unknown): ProfileChange {
  return profileChangeSchema.parse(input)
}

describe('avatar versions', () => {
  it('is "default" without a photo, else the start of its md5', () => {
    expect(avatarVersion(null)).toBe('default')
    expect(avatarVersion('0123456789abcdef0123456789abcdef')).toBe('0123456789ab')
    expect(avatarUrl('abc')).toBe('/api/avatar?v=abc')
  })
})

describe('readProfile', () => {
  it('starts at the first title with no milestones and the default photo', async () => {
    expect(await readProfile(db)).toEqual({
      title: 'Starter',
      practiceSessionsDone: 0,
      practiceClassesDone: 0,
      welcomedAt: null,
      avatarUrl: '/api/avatar?v=default',
    })
  })

  it('versions their photo the same way in the database as on the server', async () => {
    await updateProfile(db, change({ avatarJpegBase64: PHOTO }), T0)
    expect((await readProfile(db)).avatarUrl).toBe(avatarUrl(photoVersion(PHOTO)))
    await updateProfile(db, change({ avatarJpegBase64: OTHER_PHOTO }), at(DAY))
    expect((await readProfile(db)).avatarUrl).toBe(avatarUrl(photoVersion(OTHER_PHOTO)))
    expect(photoVersion(PHOTO)).not.toBe(photoVersion(OTHER_PHOTO))
  })

  it('shows the starting title if the stored one is not a real title', async () => {
    await db.execute(sql`insert into profile (id, title) values (1, 'Grandmaster')`)
    expect((await readProfile(db)).title).toBe('Starter')
  })
})

describe('updateProfile', () => {
  it('a title above Starter sets practice classes to 10 of 10; back down leaves it', async () => {
    await updateProfile(db, change({ title: 'Practitioner' }), T0)
    expect(await readProfile(db)).toMatchObject({ title: 'Practitioner', practiceClassesDone: 10 })
    await updateProfile(db, change({ title: 'Starter' }), at(DAY))
    expect(await readProfile(db)).toMatchObject({
      title: 'Starter',
      practiceClassesDone: 10,
    })
    await updateProfile(db, change({ practiceClassesDone: 3 }), at(2 * DAY))
    await updateProfile(db, change({ title: 'Starter' }), at(3 * DAY))
    expect((await readProfile(db)).practiceClassesDone).toBe(3)
    await updateProfile(db, change({ title: 'Mentor' }), at(4 * DAY))
    expect((await readProfile(db)).practiceClassesDone).toBe(10)
  })

  it('sets their title, milestones and photo, and keeps what the learner didn’t change', async () => {
    await updateProfile(db, change({ title: 'Practitioner' }), T0)
    await updateProfile(db, change({ practiceSessionsDone: 1, practiceClassesDone: 4 }), at(DAY))
    expect(await readProfile(db)).toMatchObject({
      title: 'Practitioner',
      practiceSessionsDone: 1,
      practiceClassesDone: 4,
      avatarUrl: '/api/avatar?v=default',
    })
    const [row] = await db.select().from(profile)
    expect(row?.updatedAt).toEqual(at(DAY))
  })

  it('keeps the first welcome', async () => {
    await updateProfile(db, change({ welcomed: true }), T0)
    await updateProfile(db, change({ welcomed: true, title: 'Practitioner' }), at(DAY))
    expect(await readProfile(db)).toMatchObject({ welcomedAt: T0, title: 'Practitioner' })
    await updateProfile(db, change({ title: 'Mentor' }), at(2 * DAY))
    expect((await readProfile(db)).welcomedAt).toEqual(T0)
  })

  it('records the welcome on a profile that already exists', async () => {
    await updateProfile(db, change({ title: 'Practitioner' }), T0)
    await updateProfile(db, change({ welcomed: true }), at(DAY))
    expect((await readProfile(db)).welcomedAt).toEqual(at(DAY))
  })
})

describe('profileChangeSchema', () => {
  it('takes any one or more of the changes', () => {
    expect(change({ welcomed: true })).toEqual({ welcomed: true })
    expect(change({ practiceSessionsDone: 3, practiceClassesDone: 10 })).toEqual({
      practiceSessionsDone: 3,
      practiceClassesDone: 10,
    })
    expect(change({ title: 'Mentor', extra: 1 })).toEqual({
      title: 'Mentor',
    })
  })

  it('refuses nothing to change and anything out of range', () => {
    for (const input of [
      {},
      { welcomed: false },
      { practiceSessionsDone: 4 },
      { practiceSessionsDone: -1 },
      { practiceSessionsDone: 1.5 },
      { practiceClassesDone: 11 },
      { title: 'Grandmaster' },
      { avatarJpegBase64: 'not base64!' },
      null,
    ]) {
      expect(profileChangeSchema.safeParse(input).success, JSON.stringify(input)).toBe(false)
    }
  })
})
