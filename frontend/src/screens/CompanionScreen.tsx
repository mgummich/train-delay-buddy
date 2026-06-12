import { useState, useRef, useMemo, useCallback } from 'react'
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
    <span className="inline-flex items-center gap-[4px] h-[22px] px-2 rounded-badge bg-bg-subtle text-text-muted text-[12.5px] font-semibold ml-auto">
      Gl {platform}
    </span>
  )
}

function TimelineRow({
  real,
  delay,
  planTime,
  platform,
}: {
  real: string
  delay: number | null | undefined
  planTime?: string
  platform?: string
}) {
  return (
    <div className="flex items-center gap-[10px] flex-wrap mt-[3px]">
      <span className="tnum text-[15px] font-semibold text-text-primary">{real}</span>
      {delay !== null && delay !== undefined && (
        <span
          className={`tnum text-[13px] font-semibold ${delay > 0 ? 'text-warn' : 'text-accent'}`}
        >
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
      className="fixed bottom-6 right-4 z-10 h-[44px] px-4 rounded-badge bg-accent text-accent-ink font-semibold text-[14px] flex items-center gap-2 active:scale-[0.97] transition-transform duration-fast"
      style={{ boxShadow: '0 4px 14px color-mix(in srgb, var(--accent) 40%, transparent)' }}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4l3 3" />
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
  const [finishError, setFinishError] = useState<string | null>(null)
  const currentNodeRef = useRef<HTMLDivElement>(null)

  const { data: journey } = useQuery({ ...journeyFullQuery(journeyId!), enabled: !!journeyId })
  const { data: liveSummary } = useJourney(journeyId!)

  const summary: JourneySummary = (liveSummary ?? journey?.summary) as JourneySummary

  const stops = useMemo(() => journey?.stops ?? [], [journey?.stops])
  const legs = useMemo(() => journey?.legs ?? [], [journey?.legs])

  const handleFinish = useCallback(async () => {
    try {
      const { response } = await apiClient.DELETE('/journeys/{id}', {
        params: { path: { id: journeyId! } },
      })
      if (response.ok || isDeleteNotFound(response.status, response.url)) {
        clearStore()
        await clearJourney()
        void navigate('/')
      }
    } catch {
      setFinishError(t('companion.finishError'))
    }
  }, [journeyId, t, clearStore, navigate])

  const scrollToCurrent = useCallback(() => {
    currentNodeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const currentStopIndex = useMemo(() => {
    if (!summary?.nextStep) return 1
    const { type, stationId } = summary.nextStep
    const idx = stops.findIndex((s) => s.stationId === stationId)
    if (idx < 0) return 1
    return type === 'transfer' ? idx : Math.max(0, idx - 1)
  }, [summary?.nextStep, stops])

  const mapStations = useMemo(
    () =>
      stops.map((s, i) => ({
        x: 14 + (i / Math.max(stops.length - 1, 1)) * 72,
        y: 86 - (i / Math.max(stops.length - 1, 1)) * 71,
        label: s.stationName,
        ...(s.arrivalTimeActual ? { sub: formatTime(s.arrivalTimeActual) } : {}),
        variant:
          i === 0
            ? ('dot' as const)
            : i === stops.length - 1
              ? ('dest' as const)
              : i === currentStopIndex
                ? ('current' as const)
                : ('accent' as const),
        side: i % 2 === 0 ? ('right' as const) : ('left' as const),
      })),
    [stops, currentStopIndex]
  )

  return (
    <div className="min-h-screen bg-bg-app">
      <SubAppBar eyebrow={t('companion.eyebrow')} />

      {summary && <SummaryHeader summary={summary} tab={tab} onTabChange={setTab} />}

      {tab === 'karte' && <MapView stations={mapStations} traveledTo={currentStopIndex} />}

      {tab === 'timeline' && (
        <div role="list" aria-label="Reisestationen" className="px-4 pt-[6px] pb-[70px]">
          {stops.map((stop, i) => {
            const isCurrent = i === currentStopIndex
            const isPast = i < currentStopIndex
            const isDest = i === stops.length - 1
            const kind: NodeKind = isDest
              ? 'dest'
              : isCurrent
                ? 'current'
                : isPast
                  ? 'past'
                  : 'future'
            const leg = legs[i]

            return (
              <div key={`${stop.stationId}-${i}`} role="listitem">
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
                    {i > 0 && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 top-0 bottom-1/2"
                        style={{
                          width: isPast || isCurrent ? 3 : 2.5,
                          background:
                            isPast || isCurrent ? 'var(--accent)' : 'var(--border-strong)',
                          borderRadius: 2,
                        }}
                      />
                    )}
                    <div className="absolute top-[11px] left-1/2 -translate-x-1/2">
                      <Node kind={kind} />
                    </div>
                    {i < stops.length - 1 && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 top-1/2 bottom-0"
                        style={{
                          width: isPast ? 3 : 2.5,
                          background: isPast ? 'var(--accent)' : 'var(--border-strong)',
                          borderRadius: 2,
                        }}
                      />
                    )}
                  </div>

                  {/* Stop content */}
                  <div className="flex-1 min-w-0 pb-1">
                    <h3
                      className={`font-display font-semibold text-[17px] ${isCurrent ? 'text-accent' : 'text-text-primary'}`}
                    >
                      {stop.stationName}
                    </h3>
                    <TimelineRow
                      real={
                        stop.arrivalTimeActual
                          ? formatTime(stop.arrivalTimeActual)
                          : stop.departureTimePlanned
                            ? formatTime(stop.departureTimePlanned)
                            : '–'
                      }
                      delay={stop.delayMinutes}
                      {...(stop.arrivalTimePlanned
                        ? { planTime: formatTime(stop.arrivalTimePlanned) }
                        : {})}
                      {...((stop.platformActual ?? stop.platformPlanned)
                        ? { platform: (stop.platformActual ?? stop.platformPlanned)! }
                        : {})}
                    />
                    {stop.transferBufferMinutes !== null &&
                      stop.transferBufferMinutes !== undefined &&
                      leg && (
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
                          <div
                            className="absolute left-1/2 -translate-x-1/2 inset-y-0"
                            style={{
                              width: 3,
                              backgroundImage:
                                'repeating-linear-gradient(180deg, var(--accent) 0 7px, transparent 7px 13px)',
                              borderRadius: 2,
                            }}
                          />
                          <div
                            className="vb-train absolute left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-accent text-accent-ink flex items-center justify-center z-[3]"
                            style={{ boxShadow: '0 0 0 4px var(--bg-app)' }}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                            >
                              <rect x="4" y="3" width="16" height="13" rx="3" />
                              <path d="M4 13h16" />
                              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                              <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
                            </svg>
                          </div>
                        </>
                      ) : (
                        <div
                          className="absolute left-1/2 -translate-x-1/2 inset-y-0"
                          style={{
                            width: 2.5,
                            background: 'var(--border-strong)',
                            borderRadius: 2,
                          }}
                        />
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
        {finishError && <p className="text-warn text-[13px] text-center mb-2">{finishError}</p>}
        <button
          type="button"
          onClick={() => void handleFinish()}
          className="w-full h-[50px] border-[1.5px] border-border-strong rounded-btn text-text-primary font-semibold text-[14.5px] active:scale-[0.97] transition-transform duration-fast"
        >
          {t('companion.finishBtn')}
        </button>
      </div>
    </div>
  )
}
