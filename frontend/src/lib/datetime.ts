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

/** Format ISO UTC string as HH:MM in Europe/Berlin. */
export function formatTime(isoUtc: string): string {
  return timeFormatter.format(new Date(isoUtc))
}

/** Format ISO UTC string as short date+time in Europe/Berlin. */
export function formatDateTime(isoUtc: string): string {
  return dateTimeFormatter.format(new Date(isoUtc))
}

/** Human-readable relative time ("vor 2 Minuten"). */
export function formatRelative(isoUtc: string): string {
  const diffMs = new Date(isoUtc).getTime() - Date.now()
  const diffMin = Math.round(diffMs / 60_000)
  if (Math.abs(diffMin) < 60) return relativeFormatter.format(diffMin, 'minute')
  return relativeFormatter.format(Math.round(diffMin / 60), 'hour')
}

/** How many full minutes ago was this timestamp (positive = past). */
export function minutesSince(isoUtc: string): number {
  return Math.floor((Date.now() - new Date(isoUtc).getTime()) / 60_000)
}
