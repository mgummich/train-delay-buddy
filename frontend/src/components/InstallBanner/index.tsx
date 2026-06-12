import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const SNOOZE_KEY  = 'vb-install-dismissed'
const SNOOZE_DAYS = 7

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
}

function isSnoozed(): boolean {
  const ts = localStorage.getItem(SNOOZE_KEY)
  if (!ts) return false
  const parsed = parseInt(ts, 10)
  if (isNaN(parsed)) return false
  return Date.now() - parsed < SNOOZE_DAYS * 24 * 3600 * 1000
}

interface InstallBannerProps {
  forceShow?: boolean
}

export function InstallBanner({ forceShow = false }: InstallBannerProps) {
  const { t } = useTranslation()
  const [show, setShow]   = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    if (!forceShow && (isStandalone() || isSnoozed())) return
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    setIsIOS(ios)
    setShow(true)
  }, [forceShow])

  function dismiss() {
    localStorage.setItem(SNOOZE_KEY, String(Date.now()))
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="mx-4 mt-3 bg-bg-subtle rounded-card p-3 flex items-center gap-3 text-sm">
      <span className="flex-1 text-text-primary font-medium">
        {isIOS ? t('install.ios') : t('install.android')}
      </span>
      <button
        aria-label="Banner schließen"
        onClick={dismiss}
        className="text-text-faint text-lg leading-none"
      >
        ×
      </button>
    </div>
  )
}
