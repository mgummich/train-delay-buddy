export type NodeKind = 'past' | 'current' | 'future' | 'dest'

interface NodeProps {
  kind: NodeKind
}

const BASE = 'relative z-[2] rounded-full flex items-center justify-center flex-shrink-0'

export function Node({ kind }: NodeProps) {
  if (kind === 'past') {
    return (
      <span
        aria-hidden="true"
        tabIndex={-1}
        className={`${BASE} w-[13px] h-[13px] bg-accent`}
        style={{ boxShadow: '0 0 0 4px var(--bg-app)' }}
      />
    )
  }

  if (kind === 'current') {
    return (
      <span
        aria-current="step"
        tabIndex={0}
        className={`${BASE} w-[22px] h-[22px] bg-accent vb-pulse`}
        style={{ boxShadow: '0 0 0 4px var(--bg-app), 0 0 0 6px var(--accent-soft)' }}
      >
        <span className="w-[7px] h-[7px] rounded-full bg-accent-ink" />
      </span>
    )
  }

  if (kind === 'dest') {
    return (
      <span
        tabIndex={0}
        className={`${BASE} w-[16px] h-[16px] bg-bg-card border-[2.5px] border-border-strong`}
        style={{ boxShadow: '0 0 0 4px var(--bg-app)' }}
      >
        <span className="w-[5px] h-[5px] rounded-full bg-text-faint" />
      </span>
    )
  }

  // future
  return (
    <span
      tabIndex={0}
      className={`${BASE} w-[14px] h-[14px] bg-bg-card border-[2.5px] border-border-strong`}
      style={{ boxShadow: '0 0 0 4px var(--bg-app)' }}
    />
  )
}
