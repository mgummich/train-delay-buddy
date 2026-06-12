import { useNavigate } from 'react-router-dom'

function IconBack({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

function IconSettings({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

interface SubAppBarProps {
  eyebrow:       string
  showSettings?: boolean
}

export function SubAppBar({ eyebrow, showSettings = true }: SubAppBarProps) {
  const navigate = useNavigate()

  return (
    <div className="flex items-center px-4 pt-[6px] pb-2">
      <button
        onClick={() => void navigate(-1)}
        aria-label="Zurück"
        className="-ml-2 w-[38px] h-[38px] flex items-center justify-center
          text-text-muted active:scale-[0.97] transition-transform duration-fast"
      >
        <IconBack />
      </button>

      <span className="flex-1 text-center text-[13px] font-semibold text-text-muted tracking-[.02em]">
        {eyebrow}
      </span>

      {showSettings ? (
        <button
          onClick={() => void navigate('/settings')}
          aria-label="Einstellungen"
          className="w-[38px] h-[38px] flex items-center justify-center
            text-text-muted active:scale-[0.97] transition-transform duration-fast"
        >
          <IconSettings />
        </button>
      ) : (
        <span className="w-[38px]" />
      )}
    </div>
  )
}
