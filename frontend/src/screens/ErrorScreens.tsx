import { use } from 'react'
import { useRouteError, isRouteErrorResponse, Link } from 'react-router-dom'
import { loadJourney } from '@/lib/indexeddb'

export function FullPageError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error) ? error.statusText : 'Unbekannter Fehler'

  return (
    <div className="min-h-screen bg-bg-app flex flex-col items-center justify-center p-8 gap-6">
      <p className="text-text-muted text-center">{message}</p>
      <Link to="/" className="text-accent underline">
        Zurück zum Start
      </Link>
    </div>
  )
}

export function ScreenError({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-bg-app flex flex-col items-center justify-center p-8 gap-6">
      <p className="text-text-muted text-center">{message}</p>
      <Link to="/" className="text-accent underline">
        Zurück
      </Link>
    </div>
  )
}

let cachedJourneyPromise: Promise<Awaited<ReturnType<typeof loadJourney>>> | null = null

export function CompanionError() {
  if (!cachedJourneyPromise) cachedJourneyPromise = loadJourney()
  const cached = use(cachedJourneyPromise)

  return (
    <div className="min-h-screen bg-bg-app flex flex-col p-4 gap-4">
      <div className="bg-warn-soft border border-warn rounded-card p-4">
        <p className="text-warn font-semibold">Verbindung unterbrochen</p>
      </div>
      {cached && (
        <p className="text-text-muted text-sm">Letzte bekannte Reise: {cached.journeyId}</p>
      )}
      <Link to="/" className="text-accent underline text-sm">
        Neue Verbindung suchen
      </Link>
    </div>
  )
}
