import { z } from 'zod'

import { TITLES } from '../progress/titles'

export const PRACTICE_SESSIONS = 3
export const PRACTICE_CLASSES = 10

export const profileChangeSchema = z
  .object({
    title: z.enum(TITLES).optional(),
    avatarJpegBase64: z
      .string()
      .max(400_000)
      .regex(/^[A-Za-z0-9+/=]+$/)
      .optional(),
    welcomed: z.literal(true).optional(),
    practiceSessionsDone: z.number().int().min(0).max(PRACTICE_SESSIONS).optional(),
    practiceClassesDone: z.number().int().min(0).max(PRACTICE_CLASSES).optional(),
  })

  .refine((change) => Object.keys(change).length > 0, { message: 'nothing to change' })
export type ProfileChange = z.infer<typeof profileChangeSchema>
