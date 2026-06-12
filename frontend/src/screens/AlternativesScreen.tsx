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
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

export function AlternativesScreen() {
  const { journeyId } = useParams<{ journeyId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { filters, setFilters } = useInstallStore()
  const { setJourney } = useJourneyStore()
  const [filterOpen, setFilterOpen] = useState(false)
  const [isRecalculating, setIsRecalculating] = useState(false)

  // Journey for header ETA reference
  const { data: journeyData } = useJourneyFull(journeyId!)
  // Alternatives from dedicated endpoint (Journey schema has no alternatives field)
  const { data: altsData, isLoading, isError } = useJourneyAlternatives(journeyId!)
  const qc = useQueryClient()

  // Build active filters list for FilterRow
  const activeFilters = filters.dbOnly ? [{ key: 'dbOnly', label: 'Nur DB' }] : []

  function handleSelectRoute(altJourneyId: string) {
    setJourney(altJourneyId, null)
    void navigate(`/journey/${altJourneyId}/companion`)
  }

  async function handleRecalculate() {
    if (!journeyId) return
    setIsRecalculating(true)
    try {
      await apiClient.POST('/journeys/{id}/alternatives', {
        params: { path: { id: journeyId } },
      })
      await qc.invalidateQueries({ queryKey: queryKeys.journeyAlternatives(journeyId) })
    } finally {
      setIsRecalculating(false)
    }
  }

  const alternatives = altsData?.data ?? []
  const isEmpty = !isLoading && !isError && alternatives.length === 0

  return (
    <div className="min-h-screen bg-bg-app pb-8">
      <SubAppBar eyebrow={t('alternatives.eyebrow')} />

      {/* Reference strip */}
      {journeyData?.summary && (
        <div
          className="mx-4 mt-2 bg-bg-subtle rounded-card px-[15px] py-[13px]
          flex gap-[11px] items-start"
        >
          <svg
            className="text-text-muted flex-shrink-0 mt-[1px]"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4l3 3" />
          </svg>
          <p className="text-text-muted text-[14px] leading-[1.45]">
            {t('alternatives.currentTrain', {
              time: formatTime(journeyData.summary.eta),
            })}
          </p>
        </div>
      )}

      <div className="px-4 mt-[18px] flex flex-col gap-[18px]">
        {!isEmpty && !isError && (
          <h2 className="font-display font-semibold text-[20px] text-text-primary">
            {t('alternatives.heading')}
          </h2>
        )}

        {/* Error state */}
        {isError && <ErrorBanner type="upstream" />}

        {/* Filter row */}
        {!isEmpty && !isError && (
          <FilterRow
            activeFilters={activeFilters}
            onOpenFilter={() => setFilterOpen(true)}
            onRemoveFilter={(key) => {
              if (key === 'dbOnly') setFilters({ dbOnly: false })
            }}
          />
        )}

        {/* Loading — 3 skeleton cards */}
        {isLoading && (
          <div
            className="flex flex-col gap-3"
            role="status"
            aria-label="Verbindungen werden geladen"
          >
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* Leer / empty state */}
        {isEmpty && (
          <div className="flex flex-col gap-[18px]">
            <div className="flex flex-col items-center text-center gap-[14px] pt-6 px-3 pb-2">
              <span
                className="w-16 h-16 rounded-[18px] bg-accent-soft text-accent
                flex items-center justify-center"
              >
                <IconShield />
              </span>
              <h2 className="font-display font-semibold text-[21px] text-text-primary max-w-[18ch]">
                {t('alternatives.empty.heading')}
              </h2>
              <p className="text-text-muted text-[14.5px] leading-[1.55] max-w-[32ch]">
                {t('alternatives.empty.body')}
              </p>
              <span
                className="inline-flex items-center gap-2 h-7 px-3 rounded-badge
                bg-accent-soft text-accent text-[13px] font-semibold"
              >
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
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
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
                minBuffer={alt.summary.minTransferBufferMinutes ?? 0}
                badges={[
                  ...(alt.summary.minTransferBufferMinutes != null &&
                  alt.summary.minTransferBufferMinutes < 5
                    ? ['riskant' as const]
                    : []),
                  ...(i === 0 ? ['schnellste' as const] : []),
                ]}
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
              <span
                className="w-3 h-3 border-2 border-text-muted border-t-transparent
                rounded-full animate-spin"
              />
            ) : null}
            {t('alternatives.recalcBtn')}
          </button>
        )}

        {/* Footer */}
        {!isEmpty && !isLoading && !isError && (
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
