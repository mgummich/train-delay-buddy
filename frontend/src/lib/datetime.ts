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

// en-CA yields ISO-style YYYY-MM-DD; timeZone pins it to the Berlin wall-clock day.
const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BERLIN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Parses an ISO timestamp, or null when malformed. The API is validated, but
 * safeParse deliberately passes drifted data through — so every consumer in
 * this module must tolerate garbage instead of throwing mid-render.
 */
function parseIso(iso: string): Date | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Current date as YYYY-MM-DD in Europe/Berlin (the backend's reference timezone).
 * Avoids `new Date().toISOString()`, which uses UTC and rolls over a day early
 * after Berlin midnight.
 */
export function todayBerlinDate(): string {
  return dateKeyFormatter.format(new Date())
}

/** Formats ISO UTC string as HH:MM in Europe/Berlin. Malformed input renders as "–". */
export function formatTime(isoUtc: string): string {
  const d = parseIso(isoUtc)
  return d ? timeFormatter.format(d) : '–'
}

/** Formats ISO UTC string as short date+time in Europe/Berlin. Malformed input renders as "–". */
export function formatDateTime(isoUtc: string): string {
  const d = parseIso(isoUtc)
  return d ? dateTimeFormatter.format(d) : '–'
}

/**
 * Minutes elapsed since isoUtc (positive = past, negative = future).
 * Malformed input yields Infinity: unknown freshness must surface the
 * stale-data warning, not hide it.
 */
export function minutesSince(isoUtc: string): number {
  const d = parseIso(isoUtc)
  if (!d) return Infinity
  return (Date.now() - d.getTime()) / 60_000
}
