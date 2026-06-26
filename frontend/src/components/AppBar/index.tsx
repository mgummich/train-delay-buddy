import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconSettings } from '@/components/icons/IconSettings'

function BrandMark() {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: 8,
        background: 'var(--accent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="4.5" cy="5" r="1.5" fill="white" />
        <circle cx="9.5" cy="5" r="1.5" fill="white" />
        <rect x="2" y="8" width="10" height="2" rx="1" fill="white" />
      </svg>
    </div>
  )
}

export function AppBar() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2">
        <BrandMark />
        <span className="font-display font-semibold text-[15px] text-text-primary">
          {t('app.name')}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void navigate('/settings')}
        aria-label="Einstellungen"
        className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center
          text-text-muted hover:bg-bg-subtle active:scale-[0.97] transition-transform duration-fast"
      >
        <IconSettings />
      </button>
    </div>
  )
}
