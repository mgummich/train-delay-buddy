import { useTranslation } from 'react-i18next'

interface LegBlockProps {
  line: string
  direction: string
  duration: string
  current: boolean
  delayMin?: number
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
          <span
            className="inline-flex items-center gap-[6px] h-[22px] px-2 rounded-badge
            bg-accent-soft text-accent text-[12px] font-semibold"
          >
            <span className="w-[6px] h-[6px] rounded-full bg-accent vb-blink" />
            {t('companion.currentLeg', { delay: delayMin })}
          </span>
        )}
      </div>
    </div>
  )
}
