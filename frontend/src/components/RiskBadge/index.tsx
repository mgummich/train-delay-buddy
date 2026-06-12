import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type BadgeVariant = 'riskant' | 'schnellste' | 'stabilste' | 'nur-db' | 'neutral'

const variantStyles: Record<BadgeVariant, string> = {
  riskant: 'bg-warn-soft text-warn border-transparent',
  schnellste: 'bg-accent text-accent-ink border-transparent',
  stabilste: 'bg-accent-soft text-accent border-transparent',
  'nur-db': 'bg-bg-subtle text-text-muted border-border-subtle',
  neutral: 'bg-bg-subtle text-text-muted border-border-subtle',
}

const variantLabels: Record<BadgeVariant, string> = {
  riskant: 'Riskant',
  schnellste: 'Schnellste',
  stabilste: 'Am stabilsten',
  'nur-db': 'Nur DB',
  neutral: '',
}

interface RiskBadgeProps {
  variant: BadgeVariant
  children?: ReactNode
  className?: string
  'aria-label'?: string
}

export function RiskBadge({
  variant,
  children,
  className,
  'aria-label': ariaLabel,
}: RiskBadgeProps) {
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
