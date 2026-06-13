import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { FullPageError, ScreenError, CompanionError } from '@/screens/ErrorScreens'

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

export function createRouter() {
  return createBrowserRouter(
    [
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
      },
      {
        path: '/journey/:journeyId/companion',
        element: (
          <Suspense fallback={<ScreenFallback />}>
            <CompanionScreen />
          </Suspense>
        ),
        errorElement: <CompanionError />,
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
    ],
    {
      future: {
        v7_relativeSplatPath: true,
      },
    }
  )
}
