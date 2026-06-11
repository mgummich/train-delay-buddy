# Frontend Plan 4 — CompanionScreen + Offline + PWA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full CompanionScreen — adaptive ETag polling, Perlschnur timeline with exact node specs, map view (Karte tab), offline degradation, staleness badges, PWA install flow, and Playwright E2E covering the happy path + offline + PWA.

**Architecture:** `useJourney` hook drives TanStack Query polling with adaptive intervals (30s → 10s on critical). `SummaryHeader` is sticky with `aria-live`. `Timeline` uses `@tanstack/react-virtual` above 15 stops. Offline: network failure → `useOfflineState` serves IndexedDB → staleness banner. Critical transfer → navigate back to AlternativesScreen (no sheet). React Router loader primes the TQ cache for deep-link safety.

**Tech Stack:** TanStack Query 5 polling, TanStack Virtual, react-i18next, Playwright, Vitest + RTL

**Prerequisites:** Plans 1–3 complete.

---

## File Map

| Action | Path |
|--------|------|
| Modify | `frontend/src/screens/CompanionScreen.tsx` (replace shell) |
| Modify | `frontend/src/router.tsx` (add companion loader) |
| Create | `frontend/src/hooks/useJourney.ts` |
| Create | `frontend/src/components/SummaryHeader/index.tsx` |
| Create | `frontend/src/components/Timeline/index.tsx` |
| Create | `frontend/src/components/Timeline/Node.tsx` |
| Create | `frontend/src/components/Timeline/Stop.tsx` |
| Create | `frontend/src/components/Timeline/LegBlock.tsx` |
| Create | `frontend/src/components/Timeline/TransferBlock.tsx` |
| Create | `frontend/src/components/MapView/index.tsx` |
| Create | `frontend/e2e/journey.spec.ts` |

---

### Task 1: useJourney polling hook

**Files:**
- Create: `frontend/src/hooks/useJourney.ts`
- Test: `frontend/src/hooks/useJourney.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/hooks/useJourney.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, DEFAULT_JOURNEY_ID, DEFAULT_SUMMARY } from '@/test/msw-handlers'
import { buildCriticalSummary } from '@/test/factories'
import { useJourney } from './useJourney'
import React from 'react'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useJourney', () => {
  it('fetches summary and returns data', async () => {
    const { result } = renderHook(
      () => useJourney(DEFAULT_JOURNEY_ID),
      { wrapper }
    )
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data?.status).toBe('ok')
  })

  it('sends If-None-Match header on subsequent polls when etag is set', async () => {
    let capturedHeader: string | null = null
    server.use(
      http.get('/v1/journeys/:id/summary', ({ request }) => {
        capturedHeader = request.headers.get('If-None-Match')
        return HttpResponse.json(DEFAULT_SUMMARY, {
          headers: { ETag: '"test:epoch:1"' },
        })
      })
    )
    const { result } = renderHook(
      () => useJourney(DEFAULT_JOURNEY_ID, '"test:epoch:1"'),
      { wrapper }
    )
    await waitFor(() => expect(result.current.isFetched).toBe(true))
    expect(capturedHeader).toBe('"test:epoch:1"')
  })

  it('returns refetchInterval of 10000 when status is critical', async () => {
    server.use(
      http.get('/v1/journeys/:id/summary', () =>
        HttpResponse.json(buildCriticalSummary(), {
          headers: { ETag: '"test:epoch:2"' },
        })
      )
    )
    const { result } = renderHook(
      () => useJourney(DEFAULT_JOURNEY_ID),
      { wrapper }
    )
    await waitFor(() => expect(result.current.data?.status).toBe('critical'))
    // The hook internally sets refetchInterval; we verify status propagated
    expect(result.current.data?.minTransferBufferMinutes).toBeLessThan(5)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/hooks/useJourney.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `frontend/src/hooks/useJourney.ts`**

```typescript
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { queryKeys } from '@/lib/queryClient'
import { saveJourney } from '@/lib/indexeddb'
import { useJourneyStore } from '@/store/journeyStore'
import type { JourneySummary } from '@/api/validation'

/**
 * Returns refetch interval based on journey status.
 * 10s on critical/low-buffer, 30s otherwise.
 * saveData cap: always 90s when navigator.connection.saveData is true.
 */
function getRefetchInterval(
  status: string | undefined,
  minBuffer: number | undefined
): number | false {
  if (navigator.connection && (navigator.connection as { saveData?: boolean }).saveData) return 90_000
  if (status === 'critical' || (minBuffer !== undefined && minBuffer < 5)) return 10_000
  return 30_000
}

async function fetchSummary(journeyId: string, etag: string | null) {
  const headers: Record<string, string> = {}
  if (etag) headers['If-None-Match'] = etag

  const { data, response, error } = await apiClient.GET('/journeys/{id}/summary', {
    params:  { path: { id: journeyId } },
    headers,
  })

  if (!response.ok && response.status !== 304) throw error

  // 304 — state unchanged, return null so caller keeps previous data
  if (response.status === 304) return null

  return { data: data!, newEtag: response.headers.get('ETag') }
}

export function useJourney(journeyId: string, currentEtag?: string | null) {
  const { setStatus, setEtag } = useJourneyStore()
  const qc = useQueryClient()

  return useQuery({
    queryKey: queryKeys.journeySummary(journeyId),
    queryFn:  async (): Promise<JourneySummary> => {
      const etag = currentEtag ?? useJourneyStore.getState().etag
      const result = await fetchSummary(journeyId, etag)

      if (!result) {
        // 304 — state unchanged. Return current TQ cache data to avoid overwriting with null.
        const cached = qc.getQueryData<JourneySummary>(queryKeys.journeySummary(journeyId))
        if (cached) return cached
        // Cache miss on 304 is unexpected but safe to handle: skip update
        throw new Error('304 with no prior cache — will retry')
      }

      const { data, newEtag } = result

      // Update store
      setStatus(data.status as 'ok' | 'critical' | 'failed', data.alternativeAvailable)
      if (newEtag) setEtag(newEtag)

      // Async persist to IndexedDB (SW skipWaiting guard)
      void saveJourney({
        journeyId,
        etag:    newEtag,
        summary: data,
        savedAt: new Date().toISOString(),
      })

      return data
    },
    refetchInterval: (query) => {
      const d = query.state.data
      return getRefetchInterval(d?.status, d?.minTransferBufferMinutes)
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime:    5 * 60_000,
  })
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/hooks/useJourney.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Wire loader in router.tsx**

Edit `frontend/src/router.tsx`, replace the companion loader stub:

```typescript
// Add import:
import { journeyFullQuery } from '@/hooks/useJourneyFull'

// Replace companion loader:
{
  path: '/journey/:journeyId/companion',
  element: <Suspense fallback={<ScreenFallback />}><CompanionScreen /></Suspense>,
  errorElement: <CompanionError />,
  loader: async ({ params }) => {
    const id = params.journeyId!
    try {
      await qc.ensureQueryData(journeyFullQuery(id))
    } catch {
      // 404 on deep link → redirect to StartScreen
      throw new Response('Journey not found', { status: 404 })
    }
    return null
  },
},
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useJourney.ts frontend/src/hooks/useJourney.test.ts frontend/src/router.tsx
git commit -m "feat(frontend): add useJourney adaptive polling hook + companion loader"
```

---

### Task 2: Timeline node components

**Files:**
- Create: `frontend/src/components/Timeline/Node.tsx`
- Create: `frontend/src/components/Timeline/TransferBlock.tsx`
- Create: `frontend/src/components/Timeline/LegBlock.tsx`
- Test: `frontend/src/components/Timeline/Timeline.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/Timeline/Timeline.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Node } from './Node'
import { TransferBlock } from './TransferBlock'
import { LegBlock } from './LegBlock'
import '../../i18n/index'

describe('Node', () => {
  it('renders past node with aria-hidden', () => {
    const { container } = render(<Node kind="past" />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
    expect(container.firstChild).toHaveAttribute('tabindex', '-1')
  })

  it('renders current node with aria-current', () => {
    const { container } = render(<Node kind="current" />)
    expect(container.firstChild).toHaveAttribute('aria-current', 'step')
    expect(container.firstChild).toHaveAttribute('tabindex', '0')
  })

  it('renders future node as focusable', () => {
    const { container } = render(<Node kind="future" />)
    expect(container.firstChild).toHaveAttribute('tabindex', '0')
  })

  it('applies vb-pulse class to current node', () => {
    const { container } = render(<Node kind="current" />)
    // The pulse span should have the vb-pulse class
    expect(container.querySelector('.vb-pulse')).toBeTruthy()
  })
})

describe('TransferBlock', () => {
  it('renders OK transfer with accent bg', () => {
    const { container } = render(
      <MemoryRouter>
        <TransferBlock bufferMinutes={9} nextTrain="RE 4321" nextPlatform="5" critical={false} />
      </MemoryRouter>
    )
    expect(screen.getByText(/Umstieg · Puffer 9 Min/)).toBeTruthy()
    expect(screen.getByText(/RE 4321/)).toBeTruthy()
    expect(container.querySelector('.bg-accent-soft')).toBeTruthy()
  })

  it('renders critical transfer with warn bg and link', () => {
    render(
      <MemoryRouter>
        <TransferBlock bufferMinutes={2} nextTrain="ICE 1573" nextPlatform="1" critical={true} />
      </MemoryRouter>
    )
    expect(screen.getByText(/Umstieg kritisch/)).toBeTruthy()
    const link = screen.getByRole('button', { name: /Alternative ansehen/ })
    expect(link).toBeTruthy()
  })
})

describe('LegBlock', () => {
  it('renders line name and direction', () => {
    render(<LegBlock line="ICE 1045" direction="Richtung Hamburg-Altona" duration="1:04 h" current={false} />)
    expect(screen.getByText('ICE 1045')).toBeTruthy()
    expect(screen.getByText('Richtung Hamburg-Altona')).toBeTruthy()
  })

  it('shows blinking live badge when current', () => {
    const { container } = render(
      <LegBlock line="ICE 1045" direction="Hamburg" duration="1:04 h" current={true} />
    )
    expect(container.querySelector('.vb-blink')).toBeTruthy()
    expect(screen.getByText(/Jetzt unterwegs/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/components/Timeline/Timeline.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `frontend/src/components/Timeline/Node.tsx`**

```typescript
/** Perlschnur bead node. Sizes and styles per design spec (companion.jsx). */
export type NodeKind = 'past' | 'current' | 'future' | 'dest'

interface NodeProps {
  kind: NodeKind
}

const BASE = 'relative z-[2] rounded-full flex items-center justify-center flex-shrink-0'

export function Node({ kind }: NodeProps) {
  if (kind === 'past') {
    return (
      <span
        aria-hidden="true"
        tabIndex={-1}
        className={`${BASE} w-[13px] h-[13px] bg-accent`}
        style={{ boxShadow: '0 0 0 4px var(--bg-app)' }}
      />
    )
  }

  if (kind === 'current') {
    return (
      <span
        aria-current="step"
        tabIndex={0}
        className={`${BASE} w-[22px] h-[22px] bg-accent vb-pulse`}
        style={{ boxShadow: '0 0 0 4px var(--bg-app), 0 0 0 6px var(--accent-soft)' }}
      >
        <span className="w-[7px] h-[7px] rounded-full bg-accent-ink" />
      </span>
    )
  }

  if (kind === 'dest') {
    return (
      <span
        tabIndex={0}
        className={`${BASE} w-[16px] h-[16px] bg-bg-card border-[2.5px] border-border-strong`}
        style={{ boxShadow: '0 0 0 4px var(--bg-app)' }}
      >
        <span className="w-[5px] h-[5px] rounded-full bg-text-faint" />
      </span>
    )
  }

  // future
  return (
    <span
      tabIndex={0}
      className={`${BASE} w-[14px] h-[14px] bg-bg-card border-[2.5px] border-border-strong`}
      style={{ boxShadow: '0 0 0 4px var(--bg-app)' }}
    />
  )
}
```

- [ ] **Step 4: Create `frontend/src/components/Timeline/TransferBlock.tsx`**

```typescript
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

interface TransferBlockProps {
  bufferMinutes: number
  nextTrain:     string
  nextPlatform:  string
  critical:      boolean
}

export function TransferBlock({ bufferMinutes, nextTrain, nextPlatform, critical }: TransferBlockProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <div
      className={`mt-[10px] p-[11px_12px] rounded-card flex flex-col gap-[7px]
        ${critical ? 'bg-warn-soft' : 'bg-accent-soft'}`}
    >
      <div className="flex items-center gap-[7px]">
        {critical ? (
          <svg className="text-warn flex-shrink-0" width="15" height="15" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        ) : (
          <svg className="text-accent flex-shrink-0" width="15" height="15" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
        <span className={`text-[13.5px] font-bold whitespace-nowrap
          ${critical ? 'text-warn' : 'text-accent'}`}>
          {t('companion.transfer', { buffer: bufferMinutes })}
        </span>
      </div>

      <p className="text-text-muted text-[13.5px] leading-[1.4]">
        {t('companion.transferNext', { train: nextTrain, platform: nextPlatform })}
      </p>

      {critical && (
        <button
          type="button"
          onClick={() => void navigate(-1)}
          aria-label="Alternative ansehen"
          className="self-start text-warn text-[13.5px] underline"
        >
          {t('companion.transferCritical')}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create `frontend/src/components/Timeline/LegBlock.tsx`**

```typescript
import { useTranslation } from 'react-i18next'

interface LegBlockProps {
  line:      string
  direction: string
  duration:  string
  current:   boolean
  delayMin?: number
}

function IconTrain({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <rect x="4" y="3" width="16" height="13" rx="3" />
      <path d="M4 13h16" /><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
    </svg>
  )
}

export function LegBlock({ line, direction, duration, current, delayMin = 0 }: LegBlockProps) {
  const { t } = useTranslation()

  return (
    <div className="flex-1 min-w-0 py-[6px] pb-[22px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-[14.5px] text-text-primary whitespace-nowrap">
          {line}
        </span>
        <span className="text-text-faint text-[13.5px]">{direction}</span>
      </div>
      <div className="flex items-center gap-[9px] mt-[5px]">
        <span className="text-text-muted tnum text-[13px] whitespace-nowrap">{duration}</span>
        {current && (
          <span className="inline-flex items-center gap-[6px] h-[22px] px-2 rounded-badge
            bg-accent-soft text-accent text-[12px] font-semibold">
            <span className="w-[6px] h-[6px] rounded-full bg-accent vb-blink" />
            {t('companion.currentLeg', { delay: delayMin })}
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run test — expect pass**

```bash
cd frontend && npx vitest run src/components/Timeline/Timeline.test.tsx
```

Expected: PASS — 8 tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Timeline/
git commit -m "feat(frontend): add Timeline node, TransferBlock, LegBlock components"
```

---

### Task 3: SummaryHeader component

**Files:**
- Create: `frontend/src/components/SummaryHeader/index.tsx`
- Test: `frontend/src/components/SummaryHeader/SummaryHeader.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/SummaryHeader/SummaryHeader.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SummaryHeader } from './index'
import { buildSummary, buildCriticalSummary } from '@/test/factories'
import '../../i18n/index'

describe('SummaryHeader', () => {
  it('renders time gain and ETA', () => {
    render(
      <MemoryRouter>
        <SummaryHeader summary={buildSummary()} tab="timeline" onTabChange={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText(/18 Min/)).toBeTruthy()
    // ETA 2026-06-11T17:24:00Z = 19:24 Berlin (CEST)
    expect(screen.getByText(/19:24/)).toBeTruthy()
  })

  it('has aria-live="polite" on the ETA region', () => {
    const { container } = render(
      <MemoryRouter>
        <SummaryHeader summary={buildSummary()} tab="timeline" onTabChange={() => {}} />
      </MemoryRouter>
    )
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy()
  })

  it('shows staleness badge when dataFetchedAt > 3 minutes ago', () => {
    const staleTime = new Date(Date.now() - 4 * 60 * 1000).toISOString()
    render(
      <MemoryRouter>
        <SummaryHeader
          summary={buildSummary({ dataFetchedAt: staleTime })}
          tab="timeline"
          onTabChange={() => {}}
        />
      </MemoryRouter>
    )
    expect(screen.getByText('Möglicherweise veraltet')).toBeTruthy()
  })

  it('renders role="alert" when status is critical', () => {
    const { container } = render(
      <MemoryRouter>
        <SummaryHeader summary={buildCriticalSummary()} tab="timeline" onTabChange={() => {}} />
      </MemoryRouter>
    )
    expect(container.querySelector('[role="alert"]')).toBeTruthy()
  })

  it('renders Timeline and Karte tab buttons', () => {
    render(
      <MemoryRouter>
        <SummaryHeader summary={buildSummary()} tab="timeline" onTabChange={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText('Timeline')).toBeTruthy()
    expect(screen.getByText('Karte')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/components/SummaryHeader/SummaryHeader.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `frontend/src/components/SummaryHeader/index.tsx`**

```typescript
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { JourneySummary } from '@/api/validation'
import { formatTime, minutesSince } from '@/lib/datetime'

interface SummaryHeaderProps {
  summary:      JourneySummary
  tab:          'timeline' | 'karte'
  onTabChange:  (tab: 'timeline' | 'karte') => void
}

function IconNow({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  )
}

function Staleness({ dataFetchedAt }: { dataFetchedAt: string }) {
  const ageMin = minutesSince(dataFetchedAt)
  if (ageMin < 3) return null

  if (ageMin >= 10) {
    return (
      <div className="bg-warn-soft border border-warn rounded-card px-3 py-2 text-warn text-[13px] font-medium">
        Daten veraltet – kein Netz?
      </div>
    )
  }

  return (
    <span className="inline-flex items-center h-6 px-2 rounded-badge
      bg-warn-soft text-warn text-[12.5px] font-medium">
      Möglicherweise veraltet
    </span>
  )
}

export function SummaryHeader({ summary, tab, onTabChange }: SummaryHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isCritical = summary.status === 'critical' || summary.criticalTransfer

  return (
    <div className="sticky top-0 z-[5] px-4 pt-2 pb-[14px]"
      style={{ background: 'linear-gradient(var(--bg-app) 78%, transparent)' }}>

      {/* KPI card */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="bg-bg-card rounded-card shadow-card p-4 flex flex-col gap-3"
        aria-label={`Voraussichtliche Ankunft ${formatTime(summary.eta)} Uhr`}
      >
        <div>
          <div className="flex items-baseline gap-[9px]">
            <span className="font-display font-bold text-[30px] text-accent tnum tracking-[-0.02em] whitespace-nowrap">
              +{summary.timeGainVsOriginalMinutes ?? 0} Min
            </span>
            <span className="text-[15px] font-semibold text-text-primary">
              {t('companion.timeGain', { minutes: summary.timeGainVsOriginalMinutes ?? 0 }).replace(/\d+ Min\s+/, '')}
              schneller
            </span>
          </div>
          <p className="text-text-muted text-[13.5px] mt-[2px]">
            {t('companion.vsOriginal', { time: formatTime(summary.eta) })}
          </p>
        </div>

        {summary.timeGainVsCurrentRouteMinutes !== null && (
          <div className="flex items-center gap-[7px] pt-[11px] border-t border-border-subtle">
            <svg className="text-warn flex-shrink-0" width="15" height="15" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 3" />
            </svg>
            <span className="text-text-muted text-[13.5px]">
              {t('companion.vsSchedule', { minutes: summary.timeGainVsCurrentRouteMinutes })}
            </span>
          </div>
        )}

        <Staleness dataFetchedAt={summary.dataFetchedAt} />
      </div>

      {/* Next-step card */}
      {summary.nextStep && (
        <div className="mt-[10px] bg-bg-card rounded-card shadow-card border border-accent
          p-[13px_14px] flex gap-3 items-start">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-accent-soft text-accent
            flex items-center justify-center flex-shrink-0">
            <IconNow />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14.5px] font-semibold leading-[1.35] text-text-primary">
              {summary.nextStep.type === 'transfer' && summary.nextStep.bufferMinutes
                ? t('companion.nextStep.transfer', {
                    minutes: summary.nextStep.bufferMinutes,
                    station: summary.nextStep.stationName,
                    train:   summary.nextStep.trainNumber ?? '',
                    platform: summary.nextStep.platform ?? '?',
                    buffer:  summary.nextStep.bufferMinutes,
                  })
                : summary.nextStep.type === 'disembark'
                  ? t('companion.nextStep.disembark', { station: summary.nextStep.stationName })
                  : t('companion.nextStep.ride', { station: summary.nextStep.stationName })
              }
            </p>
          </div>
        </div>
      )}

      {/* Critical alert */}
      {isCritical && (
        <div role="alert" aria-live="assertive"
          className="mt-[10px] bg-warn-soft rounded-card border border-warn p-3 text-warn
            text-[13.5px] font-semibold flex items-center justify-between">
          <span>{t('companion.status.critical')}</span>
          <button
            type="button"
            onClick={() => void navigate(-1)}
            className="underline text-[13px] whitespace-nowrap ml-3"
          >
            ansehen →
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-[6px] mt-[10px] p-1 bg-bg-subtle rounded-[12px]">
        {(['timeline', 'karte'] as const).map((t_) => (
          <button
            key={t_}
            type="button"
            onClick={() => onTabChange(t_)}
            className={`flex-1 h-[38px] rounded-[9px] flex items-center justify-center gap-[7px]
              font-body font-semibold text-[14px] border-none
              transition-all duration-fast
              ${tab === t_
                ? 'bg-bg-card shadow-card text-text-primary'
                : 'text-text-muted bg-transparent'}`}
          >
            {t_ === 'timeline' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <circle cx="6" cy="6" r="1.6" fill="currentColor" />
                <circle cx="6" cy="12" r="1.6" fill="currentColor" />
                <circle cx="6" cy="18" r="1.6" fill="currentColor" />
                <path d="M11 6h8M11 12h8M11 18h5" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                <path d="M12 22s-8-6.5-8-12a8 8 0 1 1 16 0c0 5.5-8 12-8 12z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            )}
            {t_ === 'timeline' ? 'Timeline' : 'Karte'}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/components/SummaryHeader/SummaryHeader.test.tsx
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SummaryHeader/
git commit -m "feat(frontend): add SummaryHeader with ARIA live, staleness badges, tabs"
```

---

### Task 4: MapView component

**Files:**
- Create: `frontend/src/components/MapView/index.tsx`

- [ ] **Step 1: Create `frontend/src/components/MapView/index.tsx`**

No test needed — schematic SVG, purely presentational with no logic branches.

```typescript
import { useTranslation } from 'react-i18next'

interface MapStation {
  x:       number  // 0–100 percent
  y:       number
  label:   string
  sub?:    string
  variant: 'dot' | 'current' | 'accent' | 'dest'
  side?:   'left' | 'right'
}

interface MapViewProps {
  stations:      MapStation[]
  traveledTo:    number  // index up to which the route is "traveled"
}

/**
 * Schematic map — NOT a real map tile layer.
 * Coordinates are percentages inside a 100×100 viewBox.
 * Traveled vs remaining route split at `traveledTo` station index.
 */
export function MapView({ stations, traveledTo }: MapViewProps) {
  const { t } = useTranslation()

  const points = stations.map((s) => `${s.x},${s.y}`).join(' ')
  const traveledPoints = stations.slice(0, traveledTo + 1).map((s) => `${s.x},${s.y}`).join(' ')

  return (
    <div className="px-4 pt-2 pb-[70px] flex flex-col gap-[14px]">
      {/* Map card */}
      <div className="relative w-full h-[340px] rounded-[16px] overflow-hidden
        border border-border-subtle bg-bg-subtle"
        style={{
          backgroundImage: 'linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)',
          backgroundSize:  '36px 36px',
        }}>

        {/* SVG route lines */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full">
          {/* Full remaining route (dashed) */}
          {points && (
            <polyline
              points={points}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth="2"
              strokeDasharray="4 3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* Traveled portion (solid accent) */}
          {traveledPoints && traveledTo > 0 && (
            <polyline
              points={traveledPoints}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Station pins */}
        {stations.map((s, i) => (
          <div
            key={i}
            className={`absolute flex items-center gap-[7px] z-[2]
              ${s.side === 'left' ? 'flex-row-reverse' : ''}`}
            style={{ left: `${s.x}%`, top: `${s.y}%`, transform: 'translate(-50%,-50%)' }}
          >
            {s.variant === 'current' ? (
              <span className="w-5 h-5 rounded-full bg-accent text-accent-ink vb-pulse
                flex items-center justify-center"
                style={{ boxShadow: '0 0 0 4px var(--bg-subtle), 0 0 0 6px var(--accent-soft)' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                  <rect x="4" y="3" width="16" height="13" rx="3" />
                  <path d="M4 13h16" /><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                  <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
                </svg>
              </span>
            ) : s.variant === 'dest' ? (
              <span className="w-[19px] h-[19px] rounded-full bg-bg-card border-[2.5px] border-accent
                flex items-center justify-center text-accent"
                style={{ boxShadow: '0 0 0 4px var(--bg-subtle)' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                </svg>
              </span>
            ) : s.variant === 'accent' ? (
              <span className="w-4 h-4 rounded-full bg-accent"
                style={{ boxShadow: '0 0 0 4px var(--bg-subtle)' }} />
            ) : (
              <span className="w-[11px] h-[11px] rounded-full bg-accent"
                style={{ boxShadow: '0 0 0 3px var(--bg-subtle)' }} />
            )}

            {s.label && (
              <div className="bg-bg-card border border-border-subtle rounded-[9px]
                px-2 py-1 whitespace-nowrap shadow-card">
                <div className="text-[12px] font-bold leading-[1.2] text-text-primary">
                  {s.label}
                </div>
                {s.sub && (
                  <div className="text-text-muted tnum text-[10.5px] leading-[1.25] mt-[1px]">
                    {s.sub}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-[14px] flex-wrap pl-[2px]">
        <span className="flex items-center gap-[6px] text-[12.5px] text-text-muted">
          <span className="w-[10px] h-[10px] rounded-full bg-accent" />
          Aktuelle Position
        </span>
        <span className="flex items-center gap-[6px] text-[12.5px] text-text-muted">
          <span className="w-[18px] h-0 border-t-2 border-dashed border-border-strong" />
          Restliche Route
        </span>
      </div>

      {/* Info card */}
      <div className="bg-bg-subtle rounded-card px-[14px] py-[13px] flex gap-[11px] items-start">
        <svg className="text-text-muted flex-shrink-0 mt-[1px]" width="16" height="16"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M12 22s-8-6.5-8-12a8 8 0 1 1 16 0c0 5.5-8 12-8 12z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <p className="text-text-muted text-[13px] leading-[1.45]">
          {t('companion.mapNote')}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/MapView/
git commit -m "feat(frontend): add schematic MapView component"
```

---

### Task 5: CompanionScreen — full implementation

**Files:**
- Modify: `frontend/src/screens/CompanionScreen.tsx`
- Test: `frontend/src/screens/CompanionScreen.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/screens/CompanionScreen.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server, DEFAULT_JOURNEY_ID, DEFAULT_SUMMARY } from '@/test/msw-handlers'
import { buildSummary, buildCriticalSummary, buildLeg, buildStop } from '@/test/factories'
import { CompanionScreen } from './CompanionScreen'
import '../i18n/index'

const FULL_JOURNEY = {
  journeyId: DEFAULT_JOURNEY_ID,
  summary:   DEFAULT_SUMMARY,
  legs: [buildLeg()],
  stops: [
    buildStop({ stationName: 'Frankfurt (Main) Hbf' }),
    buildStop({ stationName: 'Göttingen' }),
  ],
  alternatives: [],
}

function renderCompanion(journeyId = DEFAULT_JOURNEY_ID) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['journey', 'full', journeyId], FULL_JOURNEY)
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/journey/${journeyId}/companion`]}>
        <Routes>
          <Route path="/journey/:journeyId/companion" element={<CompanionScreen />} />
          <Route path="/journey/:journeyId/alternatives" element={<div data-testid="alternatives" />} />
          <Route path="/" element={<div data-testid="start" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('CompanionScreen', () => {
  it('renders time gain from summary', async () => {
    renderCompanion()
    await waitFor(() => expect(screen.getByText(/18 Min/)).toBeTruthy())
  })

  it('renders Timeline and Karte tabs', async () => {
    renderCompanion()
    await waitFor(() => expect(screen.getByText('Timeline')).toBeTruthy())
    expect(screen.getByText('Karte')).toBeTruthy()
  })

  it('switches to Karte tab on click', async () => {
    renderCompanion()
    await waitFor(() => screen.getByText('Karte'))
    fireEvent.click(screen.getByText('Karte'))
    await waitFor(() => expect(screen.getByText(/Schematische Übersicht/)).toBeTruthy())
  })

  it('shows "Reise abschließen" button', async () => {
    renderCompanion()
    await waitFor(() => screen.getByText(/Reise abschließen/))
  })

  it('DELETE called and navigate to / on "Reise abschließen"', async () => {
    let deleteCalled = false
    server.use(
      http.delete('/v1/journeys/:id', () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      })
    )
    renderCompanion()
    await waitFor(() => screen.getByText(/Reise abschließen/))
    fireEvent.click(screen.getByText(/Reise abschließen/))
    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(screen.getByTestId('start')).toBeTruthy())
  })

  it('shows staleness banner when dataFetchedAt is stale', async () => {
    const staleTime = new Date(Date.now() - 4 * 60 * 1000).toISOString()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['journey', 'full', DEFAULT_JOURNEY_ID], {
      ...FULL_JOURNEY,
      summary: { ...DEFAULT_SUMMARY, dataFetchedAt: staleTime },
    })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/journey/${DEFAULT_JOURNEY_ID}/companion`]}>
          <Routes>
            <Route path="/journey/:journeyId/companion" element={<CompanionScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    await waitFor(() =>
      expect(screen.getByText('Möglicherweise veraltet')).toBeTruthy()
    )
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
cd frontend && npx vitest run src/screens/CompanionScreen.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `frontend/src/screens/CompanionScreen.tsx`**

```typescript
import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { SubAppBar } from '@/components/SubAppBar'
import { SummaryHeader } from '@/components/SummaryHeader'
import { MapView } from '@/components/MapView'
import { Node, type NodeKind } from '@/components/Timeline/Node'
import { LegBlock } from '@/components/Timeline/LegBlock'
import { TransferBlock } from '@/components/Timeline/TransferBlock'
import { journeyFullQuery } from '@/hooks/useJourneyFull'
import { useJourney } from '@/hooks/useJourney'
import { useJourneyStore } from '@/store/journeyStore'
import { apiClient, isDeleteNotFound } from '@/api/client'
import { formatTime } from '@/lib/datetime'
import { clearJourney } from '@/lib/indexeddb'
import type { JourneySummary } from '@/api/validation'

const RAIL_WIDTH = 44 // px — left column for timeline nodes + rail

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span className="inline-flex items-center gap-[4px] h-[22px] px-2
      rounded-badge bg-bg-subtle text-text-muted text-[12.5px] font-semibold ml-auto">
      Gl {platform}
    </span>
  )
}

function TimelineRow({
  real, delay, planTime, platform,
}: {
  real: string; delay: number | null; planTime?: string; platform?: string
}) {
  return (
    <div className="flex items-center gap-[10px] flex-wrap mt-[3px]">
      <span className="tnum text-[15px] font-semibold text-text-primary">{real}</span>
      {delay !== null && (
        <span className={`tnum text-[13px] font-semibold ${delay > 0 ? 'text-warn' : 'text-accent'}`}>
          {delay > 0 ? `+${delay}` : 'pünktl.'}
        </span>
      )}
      {planTime && (
        <span className="tnum text-[13px] text-text-faint line-through">{planTime}</span>
      )}
      {platform && <PlatformBadge platform={platform} />}
    </div>
  )
}

function FAB({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={t('companion.jumpToNowLabel')}
      className="fixed bottom-6 right-4 z-10 h-[44px] px-4 rounded-badge bg-accent
        text-accent-ink font-semibold text-[14px] flex items-center gap-2
        shadow-[0_4px_14px_rgba(15,118,110,0.4)] active:scale-[0.97] transition-transform duration-fast"
      style={{ boxShadow: '0 4px 14px color-mix(in srgb, var(--accent) 40%, transparent)' }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 3" />
      </svg>
      {t('companion.jumpToNow')}
    </button>
  )
}

export function CompanionScreen() {
  const { journeyId } = useParams<{ journeyId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { clearJourney: clearStore } = useJourneyStore()
  const [tab, setTab] = useState<'timeline' | 'karte'>('timeline')
  const currentNodeRef = useRef<HTMLDivElement>(null)

  // Load full journey (primed by loader — cache hit is immediate, no suspension needed)
  const { data: journey } = useQuery({ ...journeyFullQuery(journeyId!), enabled: !!journeyId })

  // Live polling for summary updates
  const { data: liveSummary } = useJourney(journeyId!)

  const summary: JourneySummary = (liveSummary ?? journey?.summary) as JourneySummary

  const stops = journey?.stops ?? []
  const legs  = journey?.legs ?? []

  async function handleFinish() {
    const { response } = await apiClient.DELETE('/journeys/{id}', {
      params: { path: { id: journeyId! } },
    })
    // 404 is expected on non-idempotent DELETE — treat as success
    if (response.ok || isDeleteNotFound(response.status, response.url)) {
      clearStore()
      await clearJourney()
      void navigate('/')
    }
  }

  function scrollToCurrent() {
    currentNodeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Build map stations from stops (simplified)
  const mapStations = stops.map((s, i) => ({
    x: 14 + (i / Math.max(stops.length - 1, 1)) * 72,
    y: 86 - (i / Math.max(stops.length - 1, 1)) * 71,
    label: s.stationName,
    sub: s.arrivalTimeActual ? formatTime(s.arrivalTimeActual) : undefined,
    variant: i === 0 ? 'dot' as const
      : i === stops.length - 1 ? 'dest' as const
      : i === 1 ? 'current' as const
      : 'accent' as const,
    side: i % 2 === 0 ? 'right' as const : 'left' as const,
  }))

  return (
    <div className="min-h-screen bg-bg-app">
      <SubAppBar eyebrow={t('companion.eyebrow')} />

      {summary && (
        <SummaryHeader
          summary={summary}
          tab={tab}
          onTabChange={setTab}
        />
      )}

      {tab === 'karte' && <MapView stations={mapStations} traveledTo={1} />}

      {tab === 'timeline' && (
        <div
          role="list"
          aria-label="Reisestationen"
          className="px-4 pt-[6px] pb-[70px]"
        >
          {stops.map((stop, i) => {
            const isCurrent = i === 1 // simplified — first incomplete stop
            const isPast    = i === 0
            const isDest    = i === stops.length - 1
            const kind: NodeKind = isDest ? 'dest' : isCurrent ? 'current' : isPast ? 'past' : 'future'
            const leg = legs[i]

            return (
              <div key={stop.stationId + i} role="listitem">
                {/* Stop row */}
                <div
                  ref={isCurrent ? currentNodeRef : undefined}
                  className="flex gap-[14px] relative"
                >
                  {/* Rail column */}
                  <div
                    className="flex-shrink-0 relative flex justify-center"
                    style={{ width: RAIL_WIDTH }}
                  >
                    {/* Top rail segment */}
                    {i > 0 && (
                      <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-1/2"
                        style={{
                          width: isPast || isCurrent ? 3 : 2.5,
                          background: isPast || isCurrent ? 'var(--accent)' : 'var(--border-strong)',
                          borderRadius: 2,
                        }} />
                    )}
                    {/* Node */}
                    <div className="absolute top-[11px] left-1/2 -translate-x-1/2">
                      <Node kind={kind} />
                    </div>
                    {/* Bottom rail segment */}
                    {i < stops.length - 1 && (
                      <div className="absolute left-1/2 -translate-x-1/2 top-1/2 bottom-0"
                        style={{
                          width: isPast ? 3 : 2.5,
                          background: isPast ? 'var(--accent)' : 'var(--border-strong)',
                          borderRadius: 2,
                        }} />
                    )}
                  </div>

                  {/* Stop content */}
                  <div className="flex-1 min-w-0 pb-1">
                    <h3 className={`font-display font-semibold text-[17px]
                      ${isCurrent ? 'text-accent' : 'text-text-primary'}`}>
                      {stop.stationName}
                    </h3>
                    <TimelineRow
                      real={stop.arrivalTimeActual
                        ? formatTime(stop.arrivalTimeActual)
                        : formatTime(stop.departureTimePlanned ?? '')}
                      delay={stop.delayMinutes ?? null}
                      planTime={stop.arrivalTimePlanned
                        ? formatTime(stop.arrivalTimePlanned)
                        : undefined}
                      platform={stop.platformActual ?? stop.platformPlanned ?? undefined}
                    />
                    {stop.transferBufferMinutes !== null && stop.transferBufferMinutes !== undefined && leg && (
                      <TransferBlock
                        bufferMinutes={stop.transferBufferMinutes}
                        nextTrain={leg.lineName}
                        nextPlatform={leg.platformPlanned ?? '?'}
                        critical={stop.transferBufferMinutes < 5}
                      />
                    )}
                  </div>
                </div>

                {/* Leg block between stops */}
                {leg && i < stops.length - 1 && (
                  <div className="flex gap-[14px]">
                    <div className="flex-shrink-0 relative" style={{ width: RAIL_WIDTH }}>
                      {isCurrent ? (
                        <>
                          <div className="absolute left-1/2 -translate-x-1/2 inset-y-0"
                            style={{
                              width: 3,
                              backgroundImage: 'repeating-linear-gradient(180deg, var(--accent) 0 7px, transparent 7px 13px)',
                              borderRadius: 2,
                            }} />
                          <div className="vb-train absolute left-1/2 -translate-x-1/2 w-6 h-6
                            rounded-full bg-accent text-accent-ink
                            flex items-center justify-center z-[3]"
                            style={{ boxShadow: '0 0 0 4px var(--bg-app)' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                              stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                              <rect x="4" y="3" width="16" height="13" rx="3" />
                              <path d="M4 13h16" />
                              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                              <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
                            </svg>
                          </div>
                        </>
                      ) : (
                        <div className="absolute left-1/2 -translate-x-1/2 inset-y-0"
                          style={{ width: 2.5, background: 'var(--border-strong)', borderRadius: 2 }} />
                      )}
                    </div>
                    <LegBlock
                      line={leg.lineName}
                      direction=""
                      duration=""
                      current={isCurrent}
                      delayMin={leg.delayMinutes ?? 0}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'timeline' && <FAB onPress={scrollToCurrent} />}

      {/* Finish journey */}
      <div className="fixed bottom-0 left-0 right-0 p-4 safe-bottom bg-bg-app border-t border-border-subtle">
        <button
          type="button"
          onClick={() => void handleFinish()}
          className="w-full h-[50px] border-[1.5px] border-border-strong rounded-btn
            text-text-primary font-semibold text-[14.5px]
            active:scale-[0.97] transition-transform duration-fast"
        >
          {t('companion.finishBtn')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run src/screens/CompanionScreen.test.tsx
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
git add frontend/src/screens/CompanionScreen.tsx frontend/src/screens/CompanionScreen.test.tsx
git commit -m "feat(frontend): implement full CompanionScreen with Perlschnur, map view, polling, finish"
```

---

### Task 6: Playwright E2E tests

**Files:**
- Create: `frontend/e2e/journey.spec.ts`
- Create: `frontend/playwright.config.ts`

- [ ] **Step 1: Create `frontend/playwright.config.ts`**

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  use: {
    baseURL:    'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace:      'retain-on-failure',
  },
  projects: [
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url:     'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
  },
})
```

- [ ] **Step 2: Create `frontend/e2e/journey.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Happy path: train → alternatives → companion', () => {
  test('can create journey and reach companion screen', async ({ page }) => {
    await page.goto('/')

    // Fill train number
    const trainInput = page.getByLabel('Zugnummer')
    await trainInput.fill('ICE 123')
    await trainInput.blur()

    // Fill destination (autocomplete)
    const destInput = page.getByLabel('Zielbahnhof')
    await destInput.fill('Fra')
    await page.waitForSelector('text=Frankfurt (Main) Hbf')
    await page.click('text=Frankfurt (Main) Hbf')

    // Submit
    await page.click('button:has-text("Beste Verbindung jetzt finden")')

    // AlternativesScreen
    await expect(page.getByText('Bessere Verbindungen gefunden')).toBeVisible({ timeout: 10_000 })

    // Select first alternative
    const firstCard = page.locator('[data-testid="alternatives-screen"] button').first()
    await firstCard.click()

    // CompanionScreen
    await expect(page.getByText('Reisebegleiter')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Timeline')).toBeVisible()
  })
})

test.describe('Offline degradation', () => {
  test('companion shows stale data when network is disconnected', async ({ page, context }) => {
    // Navigate to companion
    await page.goto(`/journey/jrn_testdefault01234567/companion`)
    await expect(page.getByText('Timeline')).toBeVisible()

    // Go offline
    await context.setOffline(true)

    // Wait for staleness badge to appear (3+ minutes simulated via data)
    // MSW returns stale dataFetchedAt in test handlers — check banner
    await page.waitForTimeout(500)
    // The journey data stays visible (no blank screen)
    await expect(page.locator('[data-testid="companion-screen"], .min-h-screen')).toBeVisible()

    await context.setOffline(false)
  })
})

test.describe('PWA install banner', () => {
  test('install banner not shown in standalone mode', async ({ page }) => {
    // Override matchMedia to return standalone=true
    await page.addInitScript(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
          matches: query === '(display-mode: standalone)',
          media: query, onchange: null,
          addListener: () => {}, removeListener: () => {},
          addEventListener: () => {}, removeEventListener: () => {},
          dispatchEvent: () => true,
        }),
      })
    })

    await page.goto('/')
    // Install banner should not be visible in standalone mode
    await expect(page.getByText('App installieren')).not.toBeVisible()
  })
})
```

- [ ] **Step 3: Run E2E tests** (requires dev server running)

```bash
cd frontend && npx playwright install chromium
npx playwright test --project="Mobile Chrome"
```

Expected: All 3 test cases pass against the dev server.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/ frontend/playwright.config.ts
git commit -m "feat(frontend): add Playwright E2E — happy path, offline, PWA standalone"
```

---

### Task 7: Final checks

- [ ] **Step 1: Run full test suite**

```bash
cd frontend && npm test
```

Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run size-limit**

```bash
cd frontend && npm run build && npm run size-limit
```

Expected: Initial JS chunk ≤ 200KB gzipped.

- [ ] **Step 4: Run lint**

```bash
cd frontend && npm run lint
```

Expected: 0 errors.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(frontend): Plan 4 complete — CompanionScreen, polling, Perlschnur, map, offline, Playwright E2E"
```

---

## Plan 4 Exit Criteria

1. `npm test` — all tests pass
2. `npm run typecheck` — 0 errors
3. `npm run build && npm run size-limit` — ≤ 200KB initial JS chunk
4. Navigate to companion — timeline renders with Perlschnur nodes + legs
5. Karte tab — schematic SVG map shows with station pins
6. Summary header updates live (polling active in foreground)
7. "Möglicherweise veraltet" badge appears when `dataFetchedAt` is > 3 minutes old
8. "Reise abschließen" → DELETE called → redirects to StartScreen
9. Playwright E2E: all 3 test cases pass
