import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { JourneySummary } from '@/api/validation'
import { formatTime, minutesSince } from '@/lib/datetime'

interface SummaryHeaderProps {
  summary: JourneySummary
  tab: 'timeline' | 'karte'
  onTabChange: (tab: 'timeline' | 'karte') => void
}

function IconNow({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  )
}

function Staleness({ dataFetchedAt }: { dataFetchedAt: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 10_000)
    return () => clearInterval(id)
  }, [])

  const ageMin = minutesSince(dataFetchedAt)
  if (ageMin < 0.5) return null

  if (ageMin >= 2) {
    return (
      <div data-testid="stale-indicator" className="bg-warn-soft border border-warn rounded-card px-3 py-2 text-warn text-[13px] font-medium">
        Daten veraltet – kein Netz?
      </div>
    )
  }

  return (
    <span data-testid="stale-indicator" className="inline-flex items-center h-6 px-2 rounded-badge bg-warn-soft text-warn text-[12.5px] font-medium">
      Möglicherweise veraltet
    </span>
  )
}

export function SummaryHeader({ summary, tab, onTabChange }: SummaryHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isCritical = summary.status === 'critical' || summary.criticalTransfer

  return (
    <div
      data-testid="summary-header"
      className="sticky top-0 z-[5] px-4 pt-2 pb-[14px]"
      style={{ background: 'linear-gradient(var(--bg-app) 78%, transparent)' }}
    >
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
            <span className="text-[15px] font-semibold text-text-primary">schneller</span>
          </div>
          <p className="text-text-muted text-[13.5px] mt-[2px]">
            {t('companion.vsOriginal', { time: formatTime(summary.eta) })}
          </p>
          <time data-testid="eta" dateTime={summary.eta} className="inline-block w-px h-px overflow-hidden">
            {formatTime(summary.eta)}
          </time>
        </div>

        {summary.timeGainVsCurrentRouteMinutes !== null && (
          <div className="flex items-center gap-[7px] pt-[11px] border-t border-border-subtle">
            <svg
              className="text-warn flex-shrink-0"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4l3 3" />
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
        <div className="mt-[10px] bg-bg-card rounded-card shadow-card border border-accent p-[13px_14px] flex gap-3 items-start">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-accent-soft text-accent flex items-center justify-center flex-shrink-0">
            <IconNow />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14.5px] font-semibold leading-[1.35] text-text-primary">
              {summary.nextStep.type === 'transfer' && summary.nextStep.bufferMinutes !== null
                ? t('companion.nextStep.transfer', {
                    minutes: summary.nextStep.bufferMinutes,
                    station: summary.nextStep.stationName,
                    train: summary.nextStep.trainNumber ?? '',
                    platform: summary.nextStep.platform ?? '?',
                    buffer: summary.nextStep.bufferMinutes,
                  })
                : summary.nextStep.type === 'disembark'
                  ? t('companion.nextStep.disembark', { station: summary.nextStep.stationName })
                  : t('companion.nextStep.ride', { station: summary.nextStep.stationName })}
            </p>
          </div>
        </div>
      )}

      {/* Critical alert */}
      {isCritical && (
        <div
          data-testid="critical-warning"
          role="alert"
          aria-live="assertive"
          className="mt-[10px] bg-warn-soft rounded-card border border-warn p-3 text-warn text-[13.5px] font-semibold flex items-center justify-between"
        >
          <span>{t('companion.status.critical')}</span>
          <button
            type="button"
            onClick={() => void navigate(-1)}
            className="underline text-[13px] whitespace-nowrap ml-3"
          >
            Alternative ansehen →
          </button>
        </div>
      )}

      {/* Failed alert */}
      {summary.status === 'failed' && (
        <div
          data-testid="failed-warning"
          role="alert"
          aria-live="assertive"
          className="mt-[10px] bg-warn-soft rounded-card border border-warn p-3 text-warn text-[13.5px] font-semibold flex items-center justify-between"
        >
          <span>Route nicht mehr nutzbar</span>
          <button
            type="button"
            onClick={() => void navigate('/')}
            className="underline text-[13px] whitespace-nowrap ml-3"
          >
            Neue Verbindung suchen
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
              font-body font-semibold text-[14px] border-none transition-all duration-fast
              ${tab === t_ ? 'bg-bg-card shadow-card text-text-primary' : 'text-text-muted bg-transparent'}`}
          >
            {t_ === 'timeline' ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              >
                <circle cx="6" cy="6" r="1.6" fill="currentColor" />
                <circle cx="6" cy="12" r="1.6" fill="currentColor" />
                <circle cx="6" cy="18" r="1.6" fill="currentColor" />
                <path d="M11 6h8M11 12h8M11 18h5" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              >
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
