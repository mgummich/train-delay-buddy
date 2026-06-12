import { useTranslation } from 'react-i18next'

interface MapStation {
  x: number // 0–100 percent
  y: number
  label: string
  sub?: string
  variant: 'dot' | 'current' | 'accent' | 'dest'
  side?: 'left' | 'right'
}

interface MapViewProps {
  stations: MapStation[]
  traveledTo: number // index up to which the route is "traveled"
}

export function MapView({ stations, traveledTo }: MapViewProps) {
  const { t } = useTranslation()

  const points = stations.map((s) => `${s.x},${s.y}`).join(' ')
  const traveledPoints = stations
    .slice(0, traveledTo + 1)
    .map((s) => `${s.x},${s.y}`)
    .join(' ')

  return (
    <div className="px-4 pt-2 pb-[70px] flex flex-col gap-[14px]">
      {/* Map card */}
      <div
        className="relative w-full h-[340px] rounded-[16px] overflow-hidden border border-border-subtle bg-bg-subtle"
        style={{
          backgroundImage:
            'linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      >
        {/* SVG route lines */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
        >
          {points && (
            <polyline
              points={points}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth="2"
              strokeDasharray="4 3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {traveledPoints && traveledTo > 0 && (
            <polyline
              points={traveledPoints}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Station pins */}
        {stations.map((s, i) => (
          <div
            key={i}
            className={`absolute flex items-center gap-[7px] z-[2] ${s.side === 'left' ? 'flex-row-reverse' : ''}`}
            style={{ left: `${s.x}%`, top: `${s.y}%`, transform: 'translate(-50%,-50%)' }}
          >
            {s.variant === 'current' ? (
              <span
                className="w-5 h-5 rounded-full bg-accent text-accent-ink vb-pulse flex items-center justify-center"
                style={{ boxShadow: '0 0 0 4px var(--bg-subtle), 0 0 0 6px var(--accent-soft)' }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <rect x="4" y="3" width="16" height="13" rx="3" />
                  <path d="M4 13h16" />
                  <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                  <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
                </svg>
              </span>
            ) : s.variant === 'dest' ? (
              <span
                className="w-[19px] h-[19px] rounded-full bg-bg-card border-[2.5px] border-accent flex items-center justify-center text-accent"
                style={{ boxShadow: '0 0 0 4px var(--bg-subtle)' }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                </svg>
              </span>
            ) : s.variant === 'accent' ? (
              <span
                className="w-4 h-4 rounded-full bg-accent"
                style={{ boxShadow: '0 0 0 4px var(--bg-subtle)' }}
              />
            ) : (
              <span
                className="w-[11px] h-[11px] rounded-full bg-accent"
                style={{ boxShadow: '0 0 0 3px var(--bg-subtle)' }}
              />
            )}

            {s.label && (
              <div className="bg-bg-card border border-border-subtle rounded-[9px] px-2 py-1 whitespace-nowrap shadow-card">
                <div className="text-[12px] font-bold leading-[1.2] text-text-primary">
                  {s.label}
                </div>
                {s.sub && (
                  <div className="text-text-muted tnum text-[10.5px] leading-[1.25] mt-[1px]">
                    {s.sub}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-[14px] flex-wrap pl-[2px]">
        <span className="flex items-center gap-[6px] text-[12.5px] text-text-muted">
          <span className="w-[10px] h-[10px] rounded-full bg-accent" />
          Aktuelle Position
        </span>
        <span className="flex items-center gap-[6px] text-[12.5px] text-text-muted">
          <span className="w-[18px] h-0 border-t-2 border-dashed border-border-strong" />
          Restliche Route
        </span>
      </div>

      {/* Info card */}
      <div className="bg-bg-subtle rounded-card px-[14px] py-[13px] flex gap-[11px] items-start">
        <svg
          className="text-text-muted flex-shrink-0 mt-[1px]"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          <path d="M12 22s-8-6.5-8-12a8 8 0 1 1 16 0c0 5.5-8 12-8 12z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <p className="text-text-muted text-[13px] leading-[1.45]">{t('companion.mapNote')}</p>
      </div>
    </div>
  )
}
