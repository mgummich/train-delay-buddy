import { z } from 'zod'

export const journeyIdSchema = z.string().regex(/^jrn_[0-9a-z]{12,26}$/)

const stationSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const stationsResponseSchema = z.object({
  stations: z.array(stationSchema),
})

export const trainResponseSchema = z.object({
  trainNumber: z.string(),
  date: z.string(),
  origin: stationSchema,
  destination: stationSchema,
  stops: z.array(z.unknown()),
  status: z.enum(['running', 'cancelled', 'unknown']),
})

const nextStepSchema = z
  .object({
    type: z.enum(['ride', 'transfer', 'disembark']),
    stationName: z.string(),
    stationId: z.string(),
    trainNumber: z.string().nullable(),
    platform: z.string().nullable(),
    departureTime: z.string().nullable(),
    bufferMinutes: z.number().int().nullable(),
  })
  .nullable()

export const journeySummarySchema = z.object({
  eta: z.string(),
  status: z.enum(['ok', 'critical', 'failed']),
  timeGainVsOriginalMinutes: z.number().nullable(),
  timeGainVsCurrentRouteMinutes: z.number().nullable(),
  minTransferBufferMinutes: z.number(),
  criticalTransfer: z.boolean(),
  alternativeAvailable: z.boolean(),
  dataConfidence: z.enum(['high', 'low', 'unavailable']),
  nextStep: nextStepSchema,
  dataFetchedAt: z.string(),
  lastUpdatedAt: z.string(),
})

export type JourneySummary = z.infer<typeof journeySummarySchema>
export type NextStep = NonNullable<z.infer<typeof nextStepSchema>>

/**
 * Parse API response through schema. On failure: log the drift and return
 * raw data — never throw, because crashing a live journey is worse than
 * showing slightly stale data.
 */
export function safeParse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    console.error('[API schema drift]', result.error.issues)
    return data as T
  }
  return result.data
}
