import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

interface TransferBlockProps {
  bufferMinutes: number
  nextTrain: string
  nextPlatform: string
  critical: boolean
}

export function TransferBlock({
  bufferMinutes,
  nextTrain,
  nextPlatform,
  critical,
}: TransferBlockProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <div
      className={`mt-[10px] p-[11px_12px] rounded-card flex flex-col gap-[7px]
        ${critical ? 'bg-warn-soft' : 'bg-accent-soft'}`}
    >
      <div className="flex items-center gap-[7px]">
        {critical ? (
          <svg
            className="text-warn flex-shrink-0"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        ) : (
          <svg
            className="text-accent flex-shrink-0"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
        <span
          className={`text-[13.5px] font-bold whitespace-nowrap ${critical ? 'text-warn' : 'text-accent'}`}
        >
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
