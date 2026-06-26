import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { queryClient } from '@/lib/queryClient'
import { createRouter } from '@/router'
import { OfflineStateLoader } from '@/components/OfflineStateLoader'
import '@/i18n/index'
import '@/index.css'

// MSW is opt-in via VITE_ENABLE_MSW=true. Default dev mode hits the real backend
// through the Vite proxy; mocks are reserved for offline/demo work and tests.
async function prepareApp(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW === 'true') {
    const { worker } = await import('@/mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }
}

void prepareApp().then(() => {
  const root = document.getElementById('root')
  if (!root) throw new Error('#root element not found')

  const router = createRouter()

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/*
          OfflineStateLoader uses React 19 `use()` to suspend until IndexedDB
          is read and journeyStore hydrated. This must block RouterProvider
          so loaders see the correct journeyId on cold start.
        */}
        <Suspense fallback={null}>
          <OfflineStateLoader>
            <RouterProvider router={router} />
          </OfflineStateLoader>
        </Suspense>
      </QueryClientProvider>
    </StrictMode>
  )
})
