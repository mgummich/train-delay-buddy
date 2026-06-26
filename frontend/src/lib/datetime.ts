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

// en-CA yields ISO-style YYYY-MM-DD; timeZone pins it to the Berlin wall-clock day.
const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BERLIN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Current date as YYYY-MM-DD in Europe/Berlin (the backend's reference timezone).
 * Avoids `new Date().toISOString()`, which uses UTC and rolls over a day early
 * after Berlin midnight.
 */
export function todayBerlinDate(): string {
  return dateKeyFormatter.format(new Date())
}

/** Formats ISO UTC string as HH:MM in Europe/Berlin. */
export function formatTime(isoUtc: string): string {
  return timeFormatter.format(new Date(isoUtc))
}

/** Formats ISO UTC string as short date+time in Europe/Berlin. */
export function formatDateTime(isoUtc: string): string {
  return dateTimeFormatter.format(new Date(isoUtc))
}

/** Human-readable relative time ("vor 2 Minuten"). Rounds to minute or hour. */
export function formatRelative(isoUtc: string): string {
  const diffMs = new Date(isoUtc).getTime() - Date.now()
  const diffMin = Math.round(diffMs / 60_000)
  if (Math.abs(diffMin) < 60) return relativeFormatter.format(diffMin, 'minute')
  return relativeFormatter.format(Math.round(diffMin / 60), 'hour')
}

/** Minutes elapsed since isoUtc (positive = past, negative = future). */
export function minutesSince(isoUtc: string): number {
  return (Date.now() - new Date(isoUtc).getTime()) / 60_000
}
