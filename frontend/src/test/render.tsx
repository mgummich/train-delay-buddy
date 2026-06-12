import { type ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
}

interface WrapperProps {
  children: ReactNode
}

export function renderWithProviders(
  ui: ReactNode,
  options?: RenderOptions & { initialPath?: string }
) {
  const qc = createTestQueryClient()
  const Wrapper = ({ children }: WrapperProps) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[options?.initialPath ?? '/']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return { qc, ...render(ui, { wrapper: Wrapper, ...options }) }
}
