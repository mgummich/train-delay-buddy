# Frontend Plan 3 — AlternativesScreen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full AlternativesScreen — ranked alternative cards, removable filter chips, full filter bottom sheet, empty/Leer state, "Neu berechnen" re-route trigger, skeleton loading, and navigate to CompanionScreen on route selection.

**Architecture:** `AlternativesScreen` uses two hooks: `useJourneyFull` (`GET /journeys/{id}`) for the reference journey ETA in the header, and `useJourneyAlternatives` (`GET /journeys/{id}/alternatives`) for the alternatives list. Both are primed by the React Router loader. `Alternative` schema nests `summary: JourneySummary` — always access time gain as `alt.summary.timeGainVsOriginalMinutes`, ETA as `alt.summary.eta`. "Neu berechnen" fires `POST /journeys/{id}/alternatives` (202) then invalidates the alternatives query key.

**Tech Stack:** TanStack Query 5, React Router 6.4 loaders, Radix Sheet/Switch, react-i18next, Tailwind tokens

**Prerequisites:** Plan 2 complete — StartScreen, ErrorBanner, AppBar/SubAppBar exist.

**Subsequent plans:**
- Plan 4: CompanionScreen (live polling, Perlschnur timeline, offline, PWA)

---

## File Map

| Action | Path |
|--------|------|
| Modify | `frontend/src/screens/AlternativesScreen.tsx` (replace shell) |
| Modify | `frontend/src/router.tsx` (add loader) |
| Create | `frontend/src/hooks/useJourneyFull.ts` |
| Create | `frontend/src/hooks/useJourneyAlternatives.ts` |
| Create | `frontend/src/components/AlternativeCard/index.tsx` |
| Create | `frontend/src/components/RiskBadge/index.tsx` |
| Create | `frontend/src/components/FilterSheet/index.tsx` |
| Create | `frontend/src/components/FilterRow/index.tsx` |

---

### Task 1: useJourneyFull hook

**Files:**
- Create: `frontend/src/hooks/useJourneyFull.ts`
- Test: `frontend/src/hooks/useJourneyFull.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/hooks/useJourneyFull.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, DEFAULT_JOURNEY_ID, DEFAULT_SUMMARY, MSW_ERRORS } from '@/test/msw-handlers'
import { useJourneyFull, journeyFullQuery } from './useJourneyFull'
import React from 'react'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const FULL_JOURNEY = {
  journeyId: DEFAULT_JOURNEY_ID,
  summary:   DEFAULT_SUMMARY,
  legs:      [],
  alternatives: [],
}

describe('useJourneyFull', () => {
  it('fetches and returns journey data', async () => {
    server.use(
      http.get('/v1/journeys/:id', () => HttpResponse.json(FULL_JOURNEY))
    )
    const { result } = renderHook(
      () => useJourneyFull(DEFAULT_JOURNEY_ID),
      { wrapper }
    )
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data?.journeyId).toBe(DEFAULT_JOURNEY_ID)
  })

  it('returns error state on 404', async () => {
    server.use(
      http.get('/v1/journeys/:id', () => MSW_ERRORS.journeyNotFound())
    )
    const { result } = renderHook(
      () => useJourneyFull('jrn_notfound0000000000'),
      { wrapper }
    )
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('journeyFullQuery builds correct key', () => {
    const q = journeyFullQuery('jrn_abc')
    expect(q.queryKey).toEqual(['journey', 'full', 'jrn_abc'])
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/hooks/useJourneyFull.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `frontend/src/hooks/useJourneyFull.ts`**

```typescript
import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { queryKeys } from '@/lib/queryClient'

type JourneyFullData = Awaited<ReturnType<typeof fetchJourneyFull>>

async function fetchJourneyFull(journeyId: string) {
  const { data, error } = await apiClient.GET('/journeys/{id}', {
    params: { path: { id: journeyId } },
  })
  if (error) throw error
  return data!
}

export function journeyFullQuery(journeyId: string): UseQueryOptions<JourneyFullData> {
  return {
    queryKey: queryKeys.journeyFull(journeyId),
    queryFn:  () => fetchJourneyFull(journeyId),
    staleTime: 30_000,
    gcTime:    5 * 60_000,
  }
}

export function useJourneyFull(journeyId: string) {
  return useQuery(journeyFullQuery(journeyId))
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/hooks/useJourneyFull.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Wire loader in router.tsx**

Edit `frontend/src/router.tsx`, replace the alternatives loader stub:

```typescript
// Add import at top:
import { journeyFullQuery } from '@/hooks/useJourneyFull'

// Replace alternatives loader:
{
  path: '/journey/:journeyId/alternatives',
  element: <Suspense fallback={<ScreenFallback />}><AlternativesScreen /></Suspense>,
  errorElement: <ScreenError message="Verbindungen konnten nicht geladen werden" />,
  loader: async ({ params }) => {
    const id = params.journeyId!
    // Prime TQ cache — screen reads from cache, no double-fetch
    await qc.ensureQueryData(journeyFullQuery(id))
    return null
  },
},
```

Note: `qc` (queryClient) must be passed into `createRouter(qc)` and closed over by the loader. The router factory already receives `qc` as a parameter — use it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useJourneyFull.ts frontend/src/hooks/useJourneyFull.test.ts frontend/src/router.tsx
git commit -m "feat(frontend): add useJourneyFull hook + wire AlternativesScreen loader"
```

---

### Task 1.5: useJourneyAlternatives hook

`Journey` (from `GET /journeys/{id}`) has **no** `alternatives` field per openapi schema. Alternatives come from a dedicated endpoint: `GET /journeys/{id}/alternatives` → `AlternativesList { data: Alternative[], totalCount }`. Each `Alternative` has `{ journeyId, summary: JourneySummary, legs }`.

**Files:**
- Create: `frontend/src/hooks/useJourneyAlternatives.ts`
- Test: `frontend/src/hooks/useJourneyAlternatives.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/hooks/useJourneyAlternatives.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, DEFAULT_JOURNEY_ID, DEFAULT_SUMMARY } from '@/test/msw-handlers'
import { useJourneyAlternatives } from './useJourneyAlternatives'
import React from 'react'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

// Alternative schema: { journeyId, summary: JourneySummary, legs }
const ALT_DATA = {
  data: [
    {
      journeyId: 'jrn_alt01234567890a',
      summary: { ...DEFAULT_SUMMARY, timeGainVsOriginalMinutes: 18, eta: '2026-06-11T17:24:00Z', minTransferBufferMinutes: 3 },
      legs: [],
    },
    {
      journeyId: 'jrn_alt01234567890b',
      summary: { ...DEFAULT_SUMMARY, timeGainVsOriginalMinutes: 12, eta: '2026-06-11T17:30:00Z', minTransferBufferMinutes: 11 },
      legs: [],
    },
  ],
  totalCount: 2,
}

describe('useJourneyAlternatives', () => {
  it('fetches and returns alternatives list', async () => {
    server.use(
      http.get('/v1/journeys/:id/alternatives', () => HttpResponse.json(ALT_DATA))
    )
    const { result } = renderHook(
      () => useJourneyAlternatives(DEFAULT_JOURNEY_ID),
      { wrapper }
    )
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data?.data).toHaveLength(2)
    expect(result.current.data?.data[0]?.summary.timeGainVsOriginalMinutes).toBe(18)
  })

  it('returns empty list when no alternatives', async () => {
    server.use(
      http.get('/v1/journeys/:id/alternatives', () =>
        HttpResponse.json({ data: [], totalCount: 0 })
      )
    )
    const { result } = renderHook(
      () => useJourneyAlternatives(DEFAULT_JOURNEY_ID),
      { wrapper }
    )
    await waitFor(() => expect(result.current.isFetched).toBe(true))
    expect(result.current.data?.data).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/hooks/useJourneyAlternatives.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `frontend/src/hooks/useJourneyAlternatives.ts`**

```typescript
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { queryKeys } from '@/lib/queryClient'

async function fetchAlternatives(journeyId: string, etag: string | null) {
  const headers: Record<string, string> = {}
  if (etag) headers['If-None-Match'] = etag

  const { data, response, error } = await apiClient.GET('/journeys/{id}/alternatives', {
    params:  { path: { id: journeyId } },
    headers,
  })

  if (response.status === 304) return null  // unchanged
  if (!response.ok) throw error
  return { data: data!, newEtag: response.headers.get('ETag') }
}

export function journeyAlternativesQuery(journeyId: string) {
  return {
    queryKey: queryKeys.journeyAlternatives(journeyId),
    queryFn:  () => fetchAlternatives(journeyId, null).then(r => r?.data ?? { data: [], totalCount: 0 }),
    staleTime: 0,
    gcTime:    2 * 60_000,
  }
}

export function useJourneyAlternatives(journeyId: string) {
  return useQuery(journeyAlternativesQuery(journeyId))
}
```

- [ ] **Step 4: Update router loader to also prime alternatives query**

Edit `frontend/src/router.tsx` alternatives loader (already modified in Task 1 Step 5):

```typescript
import { journeyFullQuery } from '@/hooks/useJourneyFull'
import { journeyAlternativesQuery } from '@/hooks/useJourneyAlternatives'

// Replace alternatives loader:
{
  path: '/journey/:journeyId/alternatives',
  loader: async ({ params }) => {
    const id = params.journeyId!
    await Promise.all([
      qc.ensureQueryData(journeyFullQuery(id)),
      qc.ensureQueryData(journeyAlternativesQuery(id)),
    ])
    return null
  },
},
```

- [ ] **Step 5: Run test — expect pass**

```bash
cd frontend && npx vitest run src/hooks/useJourneyAlternatives.test.ts
```

Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useJourneyAlternatives.ts frontend/src/hooks/useJourneyAlternatives.test.ts
git commit -m "feat(frontend): add useJourneyAlternatives hook for GET /journeys/{id}/alternatives"
```

---

### Task 2: RiskBadge component

**Files:**
- Create: `frontend/src/components/RiskBadge/index.tsx`
- Test: `frontend/src/components/RiskBadge/RiskBadge.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/RiskBadge/RiskBadge.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RiskBadge } from './index'

describe('RiskBadge', () => {
  it('renders Riskant badge with warn color class', () => {
    const { container } = render(
      <RiskBadge variant="riskant" aria-label="Umstieg riskant — Puffer unter 5 Minuten" />
    )
    expect(screen.getByText('Riskant')).toBeTruthy()
    expect(container.querySelector('[aria-label]')).toBeTruthy()
  })

  it('renders Schnellste badge', () => {
    render(<RiskBadge variant="schnellste" />)
    expect(screen.getByText('Schnellste')).toBeTruthy()
  })

  it('renders custom text via children', () => {
    render(<RiskBadge variant="neutral">Nur DB</RiskBadge>)
    expect(screen.getByText('Nur DB')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/components/RiskBadge/RiskBadge.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `frontend/src/components/RiskBadge/index.tsx`**

```typescript
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type BadgeVariant = 'riskant' | 'schnellste' | 'stabilste' | 'nur-db' | 'neutral'

const variantStyles: Record<BadgeVariant, string> = {
  riskant:   'bg-warn-soft text-warn border-transparent',
  schnellste: 'bg-accent text-accent-ink border-transparent',
  stabilste: 'bg-accent-soft text-accent border-transparent',
  'nur-db':  'bg-bg-subtle text-text-muted border-border-subtle',
  neutral:   'bg-bg-subtle text-text-muted border-border-subtle',
}

const variantLabels: Record<BadgeVariant, string> = {
  riskant:   'Riskant',
  schnellste: 'Schnellste',
  stabilste: 'Am stabilsten',
  'nur-db':  'Nur DB',
  neutral:   '',
}

interface RiskBadgeProps {
  variant:      BadgeVariant
  children?:    ReactNode
  className?:   string
  'aria-label'?: string
}

export function RiskBadge({ variant, children, className, 'aria-label': ariaLabel }: RiskBadgeProps) {
  return (
    <span
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-[4px] h-6 px-[8px] rounded-badge',
        'text-[12.5px] font-semibold border',
        variantStyles[variant],
        className
      )}
    >
      {children ?? variantLabels[variant]}
    </span>
  )
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/components/RiskBadge/RiskBadge.test.tsx
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RiskBadge/
git commit -m "feat(frontend): add RiskBadge component"
```

---

### Task 3: AlternativeCard component

**Files:**
- Create: `frontend/src/components/AlternativeCard/index.tsx`
- Test: `frontend/src/components/AlternativeCard/AlternativeCard.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/AlternativeCard/AlternativeCard.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlternativeCard } from './index'
import { buildSummary } from '@/test/factories'
import '../../i18n/index'

const CARD_DATA = {
  journeyId:   'jrn_alt01234567890',
  timeGainMin: 18,
  eta:         '2026-06-11T17:24:00Z',
  transfers:   2,
  minBuffer:   3,
  badges:      ['riskant' as const, 'schnellste' as const],
  recommended: true,
}

describe('AlternativeCard', () => {
  it('renders time gain prominently', () => {
    render(<AlternativeCard {...CARD_DATA} onSelect={vi.fn()} />)
    expect(screen.getByText('+18 Min')).toBeTruthy()
  })

  it('shows arrival time and transfer count', () => {
    render(<AlternativeCard {...CARD_DATA} onSelect={vi.fn()} />)
    expect(screen.getByText(/19:24/)).toBeTruthy()
    expect(screen.getByText(/2 Umstiege/)).toBeTruthy()
  })

  it('shows Riskant badge', () => {
    render(<AlternativeCard {...CARD_DATA} onSelect={vi.fn()} />)
    expect(screen.getByText('Riskant')).toBeTruthy()
  })

  it('calls onSelect when tapped', () => {
    const onSelect = vi.fn()
    render(<AlternativeCard {...CARD_DATA} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith(CARD_DATA.journeyId)
  })

  it('applies accent border when recommended', () => {
    const { container } = render(<AlternativeCard {...CARD_DATA} onSelect={vi.fn()} />)
    expect(container.querySelector('.border-accent')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/components/AlternativeCard/AlternativeCard.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `frontend/src/components/AlternativeCard/index.tsx`**

```typescript
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { RiskBadge } from '@/components/RiskBadge'
import { formatTime } from '@/lib/datetime'

type BadgeVariant = 'riskant' | 'schnellste' | 'stabilste' | 'nur-db'

interface AlternativeCardProps {
  journeyId:   string
  timeGainMin: number
  eta:         string   // UTC ISO
  transfers:   number
  minBuffer:   number
  badges:      BadgeVariant[]
  recommended?: boolean
  onSelect:    (journeyId: string) => void
}

export function AlternativeCard({
  journeyId,
  timeGainMin,
  eta,
  transfers,
  minBuffer,
  badges,
  recommended = false,
  onSelect,
}: AlternativeCardProps) {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      onClick={() => onSelect(journeyId)}
      className={cn(
        'w-full text-left bg-bg-card rounded-card shadow-card p-4',
        'flex flex-col gap-3 border',
        'active:scale-[0.97] transition-transform duration-fast',
        recommended ? 'border-accent shadow-lift' : 'border-border-subtle'
      )}
      aria-label={`${timeGainMin} Minuten früher, Ankunft ${formatTime(eta)}`}
    >
      {/* Time gain row */}
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-[7px]">
          <span className="font-display font-bold text-[26px] text-accent tnum tracking-[-0.02em]">
            +{timeGainMin} Min
          </span>
          <span className="text-text-muted text-[15px] font-medium whitespace-nowrap">
            früher am Ziel
          </span>
        </div>
        <svg className="text-text-faint flex-shrink-0" width="20" height="20"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>

      {/* Sub-line */}
      <div className="text-text-muted tnum text-[14.5px] flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-[5px] whitespace-nowrap">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 3" />
          </svg>
          Ankunft{' '}
          <strong className="text-text-primary font-semibold">{formatTime(eta)}</strong>
        </span>
        <span className="text-text-faint">·</span>
        <span className="whitespace-nowrap">{transfers} Umstiege</span>
        <span className="text-text-faint">·</span>
        <span className="whitespace-nowrap">min. Puffer {minBuffer} Min</span>
      </div>

      {/* Badges */}
      {badges.length > 0 && (
        <div className="flex gap-[6px] flex-wrap">
          {badges.map((b) => (
            <RiskBadge
              key={b}
              variant={b}
              aria-label={
                b === 'riskant'
                  ? 'Umstieg riskant — Puffer unter 5 Minuten'
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </button>
  )
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/components/AlternativeCard/AlternativeCard.test.tsx
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AlternativeCard/
git commit -m "feat(frontend): add AlternativeCard component"
```

---

### Task 4: FilterRow component

**Files:**
- Create: `frontend/src/components/FilterRow/index.tsx`
- Test: `frontend/src/components/FilterRow/FilterRow.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/FilterRow/FilterRow.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterRow } from './index'
import '../../i18n/index'

describe('FilterRow', () => {
  it('shows filter button', () => {
    render(
      <FilterRow activeFilters={[]} onOpenFilter={vi.fn()} onRemoveFilter={vi.fn()} />
    )
    expect(screen.getByText('Filter')).toBeTruthy()
  })

  it('shows count badge when filters active', () => {
    render(
      <FilterRow
        activeFilters={[{ key: 'dbOnly', label: 'Nur DB' }]}
        onOpenFilter={vi.fn()}
        onRemoveFilter={vi.fn()}
      />
    )
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('shows active filter chip with × button', () => {
    render(
      <FilterRow
        activeFilters={[{ key: 'dbOnly', label: 'Nur DB' }]}
        onOpenFilter={vi.fn()}
        onRemoveFilter={vi.fn()}
      />
    )
    expect(screen.getByText('Nur DB')).toBeTruthy()
    // × button exists
    expect(screen.getAllByRole('button').length).toBeGreaterThan(1)
  })

  it('calls onRemoveFilter when × clicked', () => {
    const onRemove = vi.fn()
    render(
      <FilterRow
        activeFilters={[{ key: 'dbOnly', label: 'Nur DB' }]}
        onOpenFilter={vi.fn()}
        onRemoveFilter={onRemove}
      />
    )
    // The × button is the second button (after Filter button)
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1]!)
    expect(onRemove).toHaveBeenCalledWith('dbOnly')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/components/FilterRow/FilterRow.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `frontend/src/components/FilterRow/index.tsx`**

```typescript
import { useTranslation } from 'react-i18next'

interface ActiveFilter {
  key:   string
  label: string
}

interface FilterRowProps {
  activeFilters:  ActiveFilter[]
  onOpenFilter:   () => void
  onRemoveFilter: (key: string) => void
}

function IconFilter({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}

export function FilterRow({ activeFilters, onOpenFilter, onRemoveFilter }: FilterRowProps) {
  const { t } = useTranslation()

  return (
    <div className="flex gap-2 flex-wrap items-center">
      {/* Filter button with count badge */}
      <button
        type="button"
        onClick={onOpenFilter}
        className="flex items-center gap-[6px] h-9 px-3 rounded-badge border-[1.5px]
          border-border-strong text-text-primary text-[13.5px] font-medium
          active:scale-[0.97] transition-transform duration-fast bg-bg-card"
      >
        <IconFilter />
        {t('alternatives.filterBtn')}
        {activeFilters.length > 0 && (
          <span className="tnum min-w-[18px] h-[18px] px-[5px] rounded-badge
            bg-accent text-accent-ink text-[11.5px] font-bold
            flex items-center justify-center">
            {activeFilters.length}
          </span>
        )}
      </button>

      {/* Removable active filter chips */}
      {activeFilters.map((f) => (
        <span
          key={f.key}
          className="flex items-center gap-[5px] h-9 px-3 rounded-badge border-[1.5px]
            border-accent bg-accent-soft text-accent text-[13.5px] font-medium"
        >
          {f.label}
          <button
            type="button"
            onClick={() => onRemoveFilter(f.key)}
            aria-label={`${f.label} Filter entfernen`}
            className="opacity-70 hover:opacity-100 flex items-center"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/components/FilterRow/FilterRow.test.tsx
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FilterRow/
git commit -m "feat(frontend): add FilterRow component with removable filter chips"
```

---

### Task 5: FilterSheet component

**Files:**
- Create: `frontend/src/components/FilterSheet/index.tsx`
- Test: `frontend/src/components/FilterSheet/FilterSheet.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/FilterSheet/FilterSheet.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterSheet } from './index'
import { useInstallStore } from '@/store/installStore'
import '../../i18n/index'

beforeEach(() => {
  useInstallStore.setState({
    installId: '',
    filters: { dbOnly: true, maxTransfers: null, safetyLevel: 'normal' },
  })
})

describe('FilterSheet', () => {
  it('renders nothing when closed', () => {
    render(<FilterSheet open={false} onClose={vi.fn()} resultCount={3} />)
    expect(screen.queryByText('Filter')).toBeNull()
  })

  it('shows all 4 filter blocks when open', () => {
    render(<FilterSheet open={true} onClose={vi.fn()} resultCount={3} />)
    expect(screen.getByText('Nur frühere Ankünfte')).toBeTruthy()
    expect(screen.getByText('Verkehrsmittel')).toBeTruthy()
    expect(screen.getByText('Maximale Umstiege')).toBeTruthy()
    expect(screen.getByText('Puffer beim Umstieg')).toBeTruthy()
  })

  it('shows result count on apply button', () => {
    render(<FilterSheet open={true} onClose={vi.fn()} resultCount={5} />)
    expect(screen.getByText('5 Verbindungen anzeigen')).toBeTruthy()
  })

  it('shows no-results message when count is 0', () => {
    render(<FilterSheet open={true} onClose={vi.fn()} resultCount={0} />)
    expect(screen.getByText('Keine Treffer — Suche anpassen')).toBeTruthy()
  })

  it('Nur DB toggle is functional (V1)', () => {
    render(<FilterSheet open={true} onClose={vi.fn()} resultCount={3} />)
    const dbToggle = screen.getByLabelText('Nur DB-Züge')
    expect(dbToggle).not.toBeDisabled()
  })

  it('Maximale Umstiege controls are disabled in V1', () => {
    render(<FilterSheet open={true} onClose={vi.fn()} resultCount={3} />)
    // Segmented buttons for 0/1/2/3/egal should be disabled
    const buttons = screen.getAllByRole('button', { name: /^[0-9]$|^egal$/ })
    buttons.forEach(b => expect(b).toBeDisabled())
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/components/FilterSheet/FilterSheet.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `frontend/src/components/FilterSheet/index.tsx`**

```typescript
import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { useInstallStore } from '@/store/installStore'

interface FilterSheetProps {
  open:        boolean
  onClose:     () => void
  resultCount: number
}

function GrabHandle() {
  return (
    <div className="flex justify-center pt-[10px]">
      <span className="w-[38px] h-1 rounded-full bg-border-strong" />
    </div>
  )
}

export function FilterSheet({ open, onClose, resultCount }: FilterSheetProps) {
  const { t } = useTranslation()
  const { filters, setFilters } = useInstallStore()

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent
        side="bottom"
        className="bg-bg-card rounded-t-sheet shadow-sheet px-0 pb-0"
      >
        <GrabHandle />

        {/* Header */}
        <div className="flex items-center justify-between px-[18px] pt-3 pb-0">
          <h2 className="font-display font-semibold text-[20px] text-text-primary">
            {t('alternatives.filterBtn')}
          </h2>
          <button className="text-accent text-[14px]">
            {t('alternatives.filterReset')}
          </button>
        </div>

        <div className="px-[18px] pt-[18px] pb-0 flex flex-col gap-[22px] overflow-y-auto max-h-[70vh]">

          {/* Block 1 — Nur frühere Ankünfte (display-only, always ON in V1) */}
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h3 className="text-[15.5px] font-semibold text-text-primary">
                Nur frühere Ankünfte
              </h3>
              <p className="text-text-muted text-[12.5px] mt-[3px] leading-[1.4]">
                Zeigt nur Wege, die vor deinem aktuellen Zug ankommen.
              </p>
            </div>
            <Switch
              checked={true}
              aria-label="Nur frühere Ankünfte"
              aria-checked="true"
              disabled
              className="opacity-100"
            />
          </div>

          <hr className="border-border-subtle" />

          {/* Block 2 — Verkehrsmittel + Nur DB-Züge */}
          <div className="flex flex-col gap-[10px]">
            <h3 className="text-[15.5px] font-semibold text-text-primary">Verkehrsmittel</h3>
            {/* MultiChips — display-only in V1 */}
            <div className="flex gap-[7px] flex-wrap opacity-50">
              {['Fernverkehr', 'Regional', 'S-Bahn'].map((m, i) => (
                <button
                  key={m}
                  disabled
                  className={`h-9 px-3 rounded-badge border-[1.5px] text-[13.5px] font-medium
                    ${i < 2
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border-strong text-text-muted bg-bg-card'}`}
                >
                  {i < 2 && (
                    <svg className="inline mr-1" width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                  {m}
                </button>
              ))}
            </div>
            {/* Nur DB-Züge — V1 functional */}
            <div className="flex items-center gap-3 mt-[2px]">
              <span className="flex-1 text-[14.5px] font-medium text-text-primary">
                Nur DB-Züge
              </span>
              <Switch
                checked={filters.dbOnly}
                onCheckedChange={(v) => setFilters({ dbOnly: v })}
                aria-label="Nur DB-Züge"
              />
            </div>
          </div>

          <hr className="border-border-subtle" />

          {/* Block 3 — Maximale Umstiege (V2 stub, disabled) */}
          <div className="flex flex-col gap-[10px] opacity-50">
            <h3 className="text-[15.5px] font-semibold text-text-primary">
              Maximale Umstiege
            </h3>
            <div className="flex gap-[7px]">
              {['0', '1', '2', '3', 'egal'].map((v) => (
                <button
                  key={v}
                  disabled
                  className="flex-1 h-9 rounded-badge border-[1.5px] border-border-strong
                    text-text-muted text-[13.5px] font-medium bg-bg-card"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <hr className="border-border-subtle" />

          {/* Block 4 — Puffer beim Umstieg (V2 stub, disabled) */}
          <div className="flex flex-col gap-[10px] opacity-50">
            <h3 className="text-[15.5px] font-semibold text-text-primary">
              Puffer beim Umstieg
            </h3>
            <div className="flex gap-[7px]">
              {['Aggressiv', 'Normal', 'Vorsichtig'].map((v) => (
                <button
                  key={v}
                  disabled
                  className="flex-1 h-9 rounded-btn border-[1.5px] border-border-strong
                    text-text-muted text-[13.5px] font-medium bg-bg-card"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Apply button */}
        <div className="p-[18px] pt-[22px]">
          <button
            type="button"
            onClick={onClose}
            className="w-full h-[50px] bg-accent text-accent-ink rounded-btn
              font-semibold text-[15px] active:scale-[0.97] transition-transform duration-fast"
          >
            {resultCount > 0
              ? `${resultCount} Verbindungen anzeigen`
              : 'Keine Treffer — Suche anpassen'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/components/FilterSheet/FilterSheet.test.tsx
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FilterSheet/
git commit -m "feat(frontend): add FilterSheet with DB-only functional, stubs for V2 filters"
```

---

### Task 6: AlternativesScreen — full implementation

**Files:**
- Modify: `frontend/src/screens/AlternativesScreen.tsx`
- Test: `frontend/src/screens/AlternativesScreen.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/screens/AlternativesScreen.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, DEFAULT_JOURNEY_ID, DEFAULT_SUMMARY } from '@/test/msw-handlers'
import { AlternativesScreen } from './AlternativesScreen'
import '../i18n/index'

// Journey schema (GET /journeys/{id}) has NO alternatives field per openapi spec.
const JOURNEY_DATA = {
  journeyId: DEFAULT_JOURNEY_ID,
  summary:   DEFAULT_SUMMARY,
  legs:      [],
  stops:     [],
}

// Alternatives come from GET /journeys/{id}/alternatives — Alternative has nested summary.
const ALTS_DATA = {
  data: [
    {
      journeyId: 'jrn_alt01234567890a',
      summary: { ...DEFAULT_SUMMARY, timeGainVsOriginalMinutes: 18, eta: '2026-06-11T17:24:00Z', minTransferBufferMinutes: 3 },
      legs: [],
    },
    {
      journeyId: 'jrn_alt01234567890b',
      summary: { ...DEFAULT_SUMMARY, timeGainVsOriginalMinutes: 12, eta: '2026-06-11T17:30:00Z', minTransferBufferMinutes: 11 },
      legs: [],
    },
  ],
  totalCount: 2,
}

function renderAlternatives(journeyId = DEFAULT_JOURNEY_ID) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['journey', 'full',         journeyId], JOURNEY_DATA)
  qc.setQueryData(['journey', 'alternatives', journeyId], ALTS_DATA)

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/journey/${journeyId}/alternatives`]}>
        <Routes>
          <Route path="/journey/:journeyId/alternatives" element={<AlternativesScreen />} />
          <Route path="/journey/:journeyId/companion" element={<div data-testid="companion" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('AlternativesScreen', () => {
  it('renders heading', async () => {
    renderAlternatives()
    await waitFor(() =>
      expect(screen.getByText('Bessere Verbindungen gefunden')).toBeTruthy()
    )
  })

  it('renders alternative cards', async () => {
    renderAlternatives()
    await waitFor(() => expect(screen.getByText('+18 Min')).toBeTruthy())
    expect(screen.getByText('+12 Min')).toBeTruthy()
  })

  it('shows 3 skeleton cards while loading', async () => {
    // Don't pre-seed cache — let it fetch
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/journey/${DEFAULT_JOURNEY_ID}/alternatives`]}>
          <Routes>
            <Route path="/journey/:journeyId/alternatives" element={<AlternativesScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    // Immediately visible skeleton cards
    const skeletons = document.querySelectorAll('[aria-hidden="true"]')
    expect(skeletons.length).toBeGreaterThanOrEqual(3)
  })

  it('navigates to companion on card select', async () => {
    renderAlternatives()
    await waitFor(() => screen.getByText('+18 Min'))
    fireEvent.click(screen.getAllByRole('button')[0]!) // first alt card
    await waitFor(() => expect(screen.getByTestId('companion')).toBeTruthy())
  })

  it('shows Leer state when no alternatives', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['journey', 'full',         DEFAULT_JOURNEY_ID], JOURNEY_DATA)
    qc.setQueryData(['journey', 'alternatives', DEFAULT_JOURNEY_ID], { data: [], totalCount: 0 })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/journey/${DEFAULT_JOURNEY_ID}/alternatives`]}>
          <Routes>
            <Route path="/journey/:journeyId/alternatives" element={<AlternativesScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    await waitFor(() =>
      expect(screen.getByText('Aktuell keine schnellere Verbindung')).toBeTruthy()
    )
  })

  it('shows filter count badge when DB-only is ON', async () => {
    renderAlternatives()
    await waitFor(() => screen.getByText('+18 Min'))
    // DB-only is default ON → filter chip shows
    expect(screen.getByText('Nur DB')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/screens/AlternativesScreen.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/screens/AlternativesScreen.tsx`**

```typescript
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useJourneyFull } from '@/hooks/useJourneyFull'
import { useJourneyAlternatives } from '@/hooks/useJourneyAlternatives'
import { queryKeys } from '@/lib/queryClient'
import { SubAppBar } from '@/components/SubAppBar'
import { AlternativeCard } from '@/components/AlternativeCard'
import { FilterRow } from '@/components/FilterRow'
import { FilterSheet } from '@/components/FilterSheet'
import { SkeletonCard } from '@/components/Skeleton'
import { ErrorBanner } from '@/components/ErrorBanner'
import { useInstallStore } from '@/store/installStore'
import { useJourneyStore } from '@/store/journeyStore'
import { formatTime } from '@/lib/datetime'
import { apiClient } from '@/api/client'

function IconShield({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

export function AlternativesScreen() {
  const { journeyId } = useParams<{ journeyId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { filters } = useInstallStore()
  const { setJourney } = useJourneyStore()
  const [filterOpen, setFilterOpen] = useState(false)
  const [isRecalculating, setIsRecalculating] = useState(false)

  // Journey for header ETA reference
  const { data: journeyData } = useJourneyFull(journeyId!)
  // Alternatives from dedicated endpoint (Journey schema has no alternatives field)
  const { data: altsData, isLoading, isError } = useJourneyAlternatives(journeyId!)
  const qc = useQueryClient()

  // Build active filters list for FilterRow
  const activeFilters = filters.dbOnly
    ? [{ key: 'dbOnly', label: 'Nur DB' }]
    : []

  function handleSelectRoute(altJourneyId: string) {
    setJourney(altJourneyId, null)
    void navigate(`/journey/${altJourneyId}/companion`)
  }

  async function handleRecalculate() {
    if (!journeyId) return
    setIsRecalculating(true)
    await apiClient.POST('/journeys/{id}/alternatives', {
      params: { path: { id: journeyId } },
    })
    // Invalidate alternatives cache to trigger a fresh GET
    await qc.invalidateQueries({ queryKey: queryKeys.journeyAlternatives(journeyId) })
    setIsRecalculating(false)
  }

  const alternatives = altsData?.data ?? []
  const isEmpty = !isLoading && !isError && alternatives.length === 0

  return (
    <div className="min-h-screen bg-bg-app pb-8">
      <SubAppBar eyebrow={t('alternatives.eyebrow')} />

      {/* Reference strip */}
      {journeyData?.summary && (
        <div className="mx-4 mt-2 bg-bg-subtle rounded-card px-[15px] py-[13px]
          flex gap-[11px] items-start">
          <svg className="text-text-muted flex-shrink-0 mt-[1px]" width="17" height="17"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 3" />
          </svg>
          <p className="text-text-muted text-[14px] leading-[1.45]">
            {t('alternatives.currentTrain', {
              time: formatTime(journeyData.summary.eta),
            })}
          </p>
        </div>
      )}

      <div className="px-4 mt-[18px] flex flex-col gap-[18px]">
        {!isEmpty && (
          <h2 className="font-display font-semibold text-[20px] text-text-primary">
            {t('alternatives.heading')}
          </h2>
        )}

        {/* Error state */}
        {isError && (
          <ErrorBanner type="upstream" />
        )}

        {/* Filter row */}
        {!isEmpty && (
          <FilterRow
            activeFilters={activeFilters}
            onOpenFilter={() => setFilterOpen(true)}
            onRemoveFilter={(key) => {
              if (key === 'dbOnly') {
                useInstallStore.getState().setFilters({ dbOnly: false })
              }
            }}
          />
        )}

        {/* Loading — 3 skeleton cards */}
        {isLoading && (
          <div className="flex flex-col gap-3" role="status" aria-label="Verbindungen werden geladen">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* Leer / empty state */}
        {isEmpty && (
          <div className="flex flex-col gap-[18px]">
            <div className="flex flex-col items-center text-center gap-[14px] pt-6 px-3 pb-2">
              <span className="w-16 h-16 rounded-[18px] bg-accent-soft text-accent
                flex items-center justify-center">
                <IconShield />
              </span>
              <h2 className="font-display font-semibold text-[21px] text-text-primary max-w-[18ch]">
                {t('alternatives.empty.heading')}
              </h2>
              <p className="text-text-muted text-[14.5px] leading-[1.55] max-w-[32ch]">
                {t('alternatives.empty.body')}
              </p>
              <span className="inline-flex items-center gap-2 h-7 px-3 rounded-badge
                bg-accent-soft text-accent text-[13px] font-semibold">
                <span className="w-[7px] h-[7px] rounded-full bg-accent vb-blink" />
                {t('alternatives.empty.liveBadge')}
              </span>
            </div>

            <div className="bg-bg-card rounded-card shadow-card p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-text-primary">
                    {t('alternatives.empty.notifyToggle')}
                  </p>
                  <p className="text-text-muted text-[13px] leading-[1.4] mt-[3px]">
                    {t('alternatives.empty.notifySub')}
                  </p>
                </div>
                {/* Toggle — display-only in V1, push notifications are V2 */}
                <button
                  type="button"
                  className="w-11 h-6 bg-accent rounded-full relative flex-shrink-0 opacity-70"
                  disabled
                  aria-label={t('alternatives.empty.notifyToggle')}
                >
                  <span className="absolute right-1 top-1 w-4 h-4 bg-accent-ink rounded-full" />
                </button>
              </div>
              <hr className="border-border-subtle" />
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                className="w-full h-[50px] border-[1.5px] border-border-strong rounded-btn
                  text-text-primary font-semibold text-[14.5px] flex items-center justify-center gap-2
                  active:scale-[0.97] transition-transform duration-fast"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                {t('alternatives.empty.loosFilters')}
              </button>
            </div>
          </div>
        )}

        {/* Alternatives list */}
        {!isLoading && !isEmpty && (
          <div className="flex flex-col gap-3">
            {alternatives.map((alt, i) => (
              <AlternativeCard
                key={alt.journeyId}
                journeyId={alt.journeyId}
                // Alternative.summary contains the time gain, ETA, and buffer fields
                timeGainMin={alt.summary.timeGainVsOriginalMinutes ?? 0}
                eta={alt.summary.eta}
                transfers={alt.legs.length}
                minBuffer={alt.summary.minTransferBufferMinutes}
                badges={[]}
                recommended={i === 0}
                onSelect={handleSelectRoute}
              />
            ))}
          </div>
        )}

        {/* Neu berechnen */}
        {!isLoading && !isEmpty && (
          <button
            type="button"
            onClick={() => void handleRecalculate()}
            disabled={isRecalculating}
            className="self-center h-9 px-5 rounded-badge border-[1.5px] border-border-strong
              text-text-muted text-[13.5px] font-medium flex items-center gap-2
              active:scale-[0.97] transition-transform duration-fast disabled:opacity-50"
          >
            {isRecalculating ? (
              <span className="w-3 h-3 border-2 border-text-muted border-t-transparent
                rounded-full animate-spin" />
            ) : null}
            {t('alternatives.recalcBtn')}
          </button>
        )}

        {/* Footer */}
        {!isEmpty && !isLoading && (
          <p className="text-text-faint text-[12.5px] text-center leading-[1.4]">
            {t('alternatives.footer')}
          </p>
        )}
      </div>

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        resultCount={alternatives.length}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run src/screens/AlternativesScreen.test.tsx
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Run full suite**

```bash
cd frontend && npm test
```

Expected: All tests pass.

- [ ] **Step 6: Typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screens/AlternativesScreen.tsx frontend/src/screens/AlternativesScreen.test.tsx
git commit -m "feat(frontend): implement full AlternativesScreen with filter sheet, Leer state, Neu berechnen"
```

---

## Plan 3 Exit Criteria

1. `npm test` — all tests pass
2. `npm run typecheck` — 0 errors
3. Navigate to `/journey/jrn_xxx/alternatives` — alternatives load, 3 skeleton cards visible briefly
4. Alternative card tap → navigates to companion screen
5. Filter chip "Nur DB ×" removes the chip and toggles dbOnly to false
6. Filter button → sheet slides up with all 4 blocks; DB-only toggle interactive; others disabled
7. Empty/Leer state shows when no alternatives returned
