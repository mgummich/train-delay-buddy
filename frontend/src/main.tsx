import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { queryClient } from '@/lib/queryClient'
import { createRouter } from '@/router'
import { OfflineStateLoader } from '@/components/OfflineStateLoader'
import '@/i18n/index'
import '@/index.css'

// Enable MSW in development
async function prepareApp(): Promise<void> {
  if (import.meta.env.DEV) {
    const { worker } = await import('@/mocks/browser')
    await worker.start({ onUnhandledRequest: 'warn' })
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
