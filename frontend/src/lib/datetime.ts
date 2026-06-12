const BERLIN_TZ = 'Europe/Berlin'
const LOCALE = 'de-DE'

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: BERLIN_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: BERLIN_TZ,
  dateStyle: 'short',
  timeStyle: 'short',
})

const relativeFormatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' })

/**
 * Format ISO UTC string as HH:MM in Europe/Berlin.
 * @param isoUtc - ISO 8601 UTC timestamp string (e.g. "2026-06-12T14:30:00Z").
 * @returns Time string formatted as HH:MM in the Europe/Berlin timezone.
 */
export function formatTime(isoUtc: string): string {
  return timeFormatter.format(new Date(isoUtc))
}

/**
 * Format ISO UTC string as short date+time in Europe/Berlin.
 * @param isoUtc - ISO 8601 UTC timestamp string (e.g. "2026-06-12T14:30:00Z").
 * @returns Short date and time string formatted in the Europe/Berlin timezone.
 */
export function formatDateTime(isoUtc: string): string {
  return dateTimeFormatter.format(new Date(isoUtc))
}

/**
 * Human-readable relative time ("vor 2 Minuten").
 * @param isoUtc - ISO 8601 UTC timestamp string to compare against the current time.
 * @returns Locale-formatted relative string; rounds to nearest minute when the
 *   difference is under 60 minutes, otherwise rounds to the nearest hour.
 */
export function formatRelative(isoUtc: string): string {
  const diffMs = new Date(isoUtc).getTime() - Date.now()
  const diffMin = Math.round(diffMs / 60_000)
  if (Math.abs(diffMin) < 60) return relativeFormatter.format(diffMin, 'minute')
  return relativeFormatter.format(Math.round(diffMin / 60), 'hour')
}

/**
 * How many full minutes ago was this timestamp (positive = past).
 * @param isoUtc - ISO 8601 UTC timestamp string to measure from.
 * @returns Elapsed full minutes: positive when the timestamp is in the past,
 *   negative when it is in the future.
 */
export function minutesSince(isoUtc: string): number {
  return Math.floor((Date.now() - new Date(isoUtc).getTime()) / 60_000)
}
