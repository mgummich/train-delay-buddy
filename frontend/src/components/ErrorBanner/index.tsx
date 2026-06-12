import { useTranslation } from 'react-i18next'

type ErrorType = 'offline' | 'upstream' | 'overloaded' | 'rate-limit' | 'unknown'

interface ErrorBannerProps {
  type: ErrorType
  lastUpdated?: string
  onRetry?: () => void
}

export function ErrorBanner({ type, lastUpdated, onRetry }: ErrorBannerProps) {
  const { t } = useTranslation()

  const messages: Record<ErrorType, string> = {
    offline: lastUpdated
      ? t('errors.offline', { time: new Date(lastUpdated).toLocaleTimeString('de-DE') })
      : t('errors.offline', { time: '–' }),
    upstream: t('errors.upstream'),
    overloaded: t('errors.overloaded'),
    'rate-limit': t('errors.rateLimit'),
    unknown: t('errors.unknown'),
  }

  const isFullscreen = type === 'overloaded'

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 bg-bg-app flex flex-col items-center justify-center p-8 gap-6 z-50">
        <p className="text-text-primary text-center font-semibold">{messages[type]}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="w-full max-w-xs h-[50px] bg-accent text-accent-ink rounded-btn font-semibold
              active:scale-[0.97] transition-transform duration-fast"
          >
            {t('errors.retry')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      role="status"
      className="mx-4 mt-2 px-4 py-3 bg-warn-soft rounded-card text-warn text-sm font-medium flex items-center gap-2"
    >
      <span className="flex-1">{messages[type]}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-warn underline text-sm whitespace-nowrap">
          {t('errors.retry')}
        </button>
      )}
    </div>
  )
}
