import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'
import { FullPageError, ScreenError, CompanionError } from '@/screens/ErrorScreens'
import { journeyFullQuery } from '@/hooks/useJourneyFull'
import { journeyAlternativesQuery } from '@/hooks/useJourneyAlternatives'

// Route-based code splitting — each screen is its own chunk
const StartScreen = lazy(() =>
  import('@/screens/StartScreen').then((m) => ({ default: m.StartScreen }))
)
const AlternativesScreen = lazy(() =>
  import('@/screens/AlternativesScreen').then((m) => ({ default: m.AlternativesScreen }))
)
const CompanionScreen = lazy(() =>
  import('@/screens/CompanionScreen').then((m) => ({ default: m.CompanionScreen }))
)
const SettingsScreen = lazy(() =>
  import('@/screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen }))
)

const ScreenFallback = () => <div className="min-h-screen bg-bg-app" />

export function createRouter(qc: QueryClient) {
  return createBrowserRouter([
    {
      path: '/',
      element: (
        <Suspense fallback={<ScreenFallback />}>
          <StartScreen />
        </Suspense>
      ),
      errorElement: <FullPageError />,
    },
    {
      path: '/journey/:journeyId/alternatives',
      element: (
        <Suspense fallback={<ScreenFallback />}>
          <AlternativesScreen />
        </Suspense>
      ),
      errorElement: <ScreenError message="Verbindungen konnten nicht geladen werden" />,
      loader: async ({ params }) => {
        const id = params.journeyId!
        await Promise.all([
          qc.ensureQueryData(journeyFullQuery(id)),
          qc.ensureQueryData(journeyAlternativesQuery(id)),
        ])
        return null
      },
    },
    {
      path: '/journey/:journeyId/companion',
      element: (
        <Suspense fallback={<ScreenFallback />}>
          <CompanionScreen />
        </Suspense>
      ),
      errorElement: <CompanionError />,
      loader: async ({ params }) => {
        const id = params.journeyId!
        try {
          await qc.ensureQueryData(journeyFullQuery(id))
        } catch {
          throw new Response('Journey not found', { status: 404 })
        }
        return null
      },
    },
    {
      path: '/settings',
      element: (
        <Suspense fallback={<ScreenFallback />}>
          <SettingsScreen />
        </Suspense>
      ),
      errorElement: <FullPageError />,
    },
    {
      path: '*',
      element: <Navigate to="/" replace />,
    },
  ], {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  })
}
