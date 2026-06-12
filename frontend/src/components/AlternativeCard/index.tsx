import { memo } from 'react'
import { cn } from '@/lib/utils'
import { RiskBadge } from '@/components/RiskBadge'
import { formatTime } from '@/lib/datetime'

type BadgeVariant = 'riskant' | 'schnellste' | 'stabilste' | 'nur-db'

interface AlternativeCardProps {
  journeyId: string
  timeGainMin: number
  eta: string // UTC ISO
  transfers: number
  minBuffer: number
  badges: BadgeVariant[]
  recommended?: boolean
  onSelect: (journeyId: string) => void
}

export const AlternativeCard = memo(function AlternativeCard({
  journeyId,
  timeGainMin,
  eta,
  transfers,
  minBuffer,
  badges,
  recommended = false,
  onSelect,
}: AlternativeCardProps) {
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
        <svg
          className="text-text-faint flex-shrink-0"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>

      {/* Sub-line */}
      <div className="text-text-muted tnum text-[14.5px] flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-[5px] whitespace-nowrap">
          <svg
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
          Ankunft <strong className="text-text-primary font-semibold">{formatTime(eta)}</strong>
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
              {...(b === 'riskant'
                ? { 'aria-label': 'Umstieg riskant — Puffer unter 5 Minuten' }
                : {})}
            />
          ))}
        </div>
      )}
    </button>
  )
})
