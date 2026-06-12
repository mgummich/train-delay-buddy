import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { useInstallStore } from '@/store/installStore'

interface FilterSheetProps {
  open: boolean
  onClose: () => void
  resultCount: number
}

function GrabHandle() {
  return (
    <div className="flex justify-center pt-[10px]">
      <span className="w-[38px] h-1 rounded-full bg-border-strong" />
    </div>
  )
}

export function FilterSheet({ open, onClose, resultCount }: FilterSheetProps) {
  const { t } = useTranslation()
  const { filters, setFilters } = useInstallStore()

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <SheetContent
        side="bottom"
        className="bg-bg-card rounded-t-sheet shadow-sheet px-0 pb-0"
        aria-describedby={undefined}
      >
        <GrabHandle />

        {/* Header */}
        <div className="flex items-center justify-between px-[18px] pt-3 pb-0">
          <SheetTitle className="font-display font-semibold text-[20px] text-text-primary">
            {t('alternatives.filterBtn')}
          </SheetTitle>
          <button disabled className="text-text-faint text-[14px] opacity-50 cursor-not-allowed">
            {t('alternatives.filterReset')}
          </button>
        </div>

        <div className="px-[18px] pt-[18px] pb-0 flex flex-col gap-[22px] overflow-y-auto max-h-[70vh]">
          {/* Block 1 — Nur frühere Ankünfte (display-only, always ON in V1) */}
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h3 className="text-[15.5px] font-semibold text-text-primary">
                Nur frühere Ankünfte
              </h3>
              <p className="text-text-muted text-[12.5px] mt-[3px] leading-[1.4]">
                Zeigt nur Wege, die vor deinem aktuellen Zug ankommen.
              </p>
            </div>
            <Switch
              checked={true}
              aria-label="Nur frühere Ankünfte"
              disabled
              className="opacity-100"
            />
          </div>

          <hr className="border-border-subtle" />

          {/* Block 2 — Verkehrsmittel + Nur DB-Züge */}
          <div className="flex flex-col gap-[10px]">
            <h3 className="text-[15.5px] font-semibold text-text-primary">Verkehrsmittel</h3>
            {/* MultiChips — display-only in V1 */}
            <div className="flex gap-[7px] flex-wrap opacity-50">
              {['Fernverkehr', 'Regional', 'S-Bahn'].map((m, i) => (
                <button
                  key={m}
                  disabled
                  className={`h-9 px-3 rounded-badge border-[1.5px] text-[13.5px] font-medium
                    ${
                      i < 2
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border-strong text-text-muted bg-bg-card'
                    }`}
                >
                  {i < 2 && (
                    <svg
                      className="inline mr-1"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                  {m}
                </button>
              ))}
            </div>
            {/* Nur DB-Züge — V1 functional */}
            <div className="flex items-center gap-3 mt-[2px]">
              <span className="flex-1 text-[14.5px] font-medium text-text-primary">
                Nur DB-Züge
              </span>
              <Switch
                checked={filters.dbOnly}
                onCheckedChange={(v) => setFilters({ dbOnly: v })}
                aria-label="Nur DB-Züge"
              />
            </div>
          </div>

          <hr className="border-border-subtle" />

          {/* Block 3 — Maximale Umstiege (V2 stub, disabled) */}
          <div className="flex flex-col gap-[10px] opacity-50">
            <h3 className="text-[15.5px] font-semibold text-text-primary">Maximale Umstiege</h3>
            <div className="flex gap-[7px]">
              {['0', '1', '2', '3', 'egal'].map((v) => (
                <button
                  key={v}
                  disabled
                  className="flex-1 h-9 rounded-badge border-[1.5px] border-border-strong
                    text-text-muted text-[13.5px] font-medium bg-bg-card"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <hr className="border-border-subtle" />

          {/* Block 4 — Puffer beim Umstieg (V2 stub, disabled) */}
          <div className="flex flex-col gap-[10px] opacity-50">
            <h3 className="text-[15.5px] font-semibold text-text-primary">Puffer beim Umstieg</h3>
            <div className="flex gap-[7px]">
              {['Aggressiv', 'Normal', 'Vorsichtig'].map((v) => (
                <button
                  key={v}
                  disabled
                  className="flex-1 h-9 rounded-btn border-[1.5px] border-border-strong
                    text-text-muted text-[13.5px] font-medium bg-bg-card"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Apply button */}
        <div className="p-[18px] pt-[22px]">
          <button
            type="button"
            onClick={onClose}
            className="w-full h-[50px] bg-accent text-accent-ink rounded-btn
              font-semibold text-[15px] active:scale-[0.97] transition-transform duration-fast"
          >
            {resultCount > 0
              ? `${resultCount} Verbindungen anzeigen`
              : 'Keine Treffer — Suche anpassen'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
