import { useTranslation } from 'react-i18next'

interface ActiveFilter {
  key: string
  label: string
}

interface FilterRowProps {
  activeFilters: ActiveFilter[]
  onOpenFilter: () => void
  onRemoveFilter: (key: string) => void
}

function IconFilter({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}

export function FilterRow({ activeFilters, onOpenFilter, onRemoveFilter }: FilterRowProps) {
  const { t } = useTranslation()

  return (
    <div className="flex gap-2 flex-wrap items-center">
      {/* Filter button with count badge */}
      <button
        type="button"
        onClick={onOpenFilter}
        className="flex items-center gap-[6px] h-9 px-3 rounded-badge border-[1.5px]
          border-border-strong text-text-primary text-[13.5px] font-medium
          active:scale-[0.97] transition-transform duration-fast bg-bg-card"
      >
        <IconFilter />
        {t('alternatives.filterBtn')}
        {activeFilters.length > 0 && (
          <span
            data-testid="filter-count"
            className="tnum min-w-[18px] h-[18px] px-[5px] rounded-badge
            bg-accent text-accent-ink text-[11.5px] font-bold
            flex items-center justify-center"
          >
            {activeFilters.length}
          </span>
        )}
      </button>

      {/* Removable active filter chips */}
      {activeFilters.map((f) => (
        <span
          key={f.key}
          className="flex items-center gap-[5px] h-9 px-3 rounded-badge border-[1.5px]
            border-accent bg-accent-soft text-accent text-[13.5px] font-medium"
        >
          {f.label}
          <button
            type="button"
            onClick={() => onRemoveFilter(f.key)}
            aria-label={`${f.label} Filter entfernen`}
            className="opacity-70 hover:opacity-100 flex items-center"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      ))}
    </div>
  )
}
