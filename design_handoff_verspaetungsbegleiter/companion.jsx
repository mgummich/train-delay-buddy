// companion.jsx — Screen 3: Reisebegleiter (Perlschnur / timeline)
// Exported to window as ScreenCompanion.

const RAIL = 44; // px width of the left rail

/* a node on the bead-string */
function Node({ kind }) {
  // kind: 'past' | 'current' | 'future' | 'dest'
  const base = {
    position: 'relative', zIndex: 2, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  if (kind === 'past') return (
    <span style={{ ...base, width: 13, height: 13, background: 'var(--c-accent)',
      boxShadow: '0 0 0 4px var(--c-bg)' }} />
  );
  if (kind === 'current') return (
    <span className="vb-pulse" style={{ ...base, width: 22, height: 22, background: 'var(--c-accent)',
      boxShadow: '0 0 0 4px var(--c-bg), 0 0 0 6px var(--c-accent-soft)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--c-accent-ink)' }} />
    </span>
  );
  if (kind === 'dest') return (
    <span style={{ ...base, width: 16, height: 16, background: 'var(--c-card)',
      border: '2.5px solid var(--c-border-strong)', boxShadow: '0 0 0 4px var(--c-bg)' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--c-faint)' }} />
    </span>
  );
  return (
    <span style={{ ...base, width: 14, height: 14, background: 'var(--c-card)',
      border: '2.5px solid var(--c-border-strong)', boxShadow: '0 0 0 4px var(--c-bg)' }} />
  );
}

/* vertical line segment that fills the rail; pos = 'top'|'bottom'|'full'|'none' */
function Rail({ top = 'none', bottom = 'none', current = false }) {
  const col = (s) => s === 'past' ? 'var(--c-accent)' : s === 'future' ? 'var(--c-border-strong)' : 'transparent';
  return (
    <div style={{ width: RAIL, position: 'relative', display: 'flex', justifyContent: 'center', flex: '0 0 auto' }}>
      <div style={{ position: 'absolute', top: 0, bottom: '50%', width: top === 'past' || current ? 3 : 2.5,
        background: current ? 'var(--c-accent)' : col(top), borderRadius: 2 }} />
      <div style={{ position: 'absolute', top: '50%', bottom: 0, width: bottom === 'past' || current ? 3 : 2.5,
        background: current ? 'var(--c-accent)' : col(bottom), borderRadius: 2,
        ...(current ? { backgroundImage: 'repeating-linear-gradient(0deg, var(--c-accent) 0 8px, transparent 8px 14px)', background: 'none' } : {}) }} />
    </div>
  );
}

function StopRow({ node, children, top, bottom }) {
  return (
    <div style={{ display: 'flex', gap: 14, minHeight: 30 }}>
      <Rail top={top} bottom={bottom} />
      <div style={{ paddingTop: 1, paddingBottom: 18, flex: 1, marginTop: -7 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 22 }}></div>
      </div>
    </div>
  );
}

/* Because a stop needs the node vertically centered against its rail-mid, we
   render node + content as one flex row with the node absolutely centered. */
function Stop({ kind, top, bottom, children }) {
  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative' }}>
      <div style={{ width: RAIL, position: 'relative', flex: '0 0 auto' }}>
        <div style={{ position: 'absolute', left: '50%', top: 11, transform: 'translateX(-50%)' }}>
          <Node kind={kind} />
        </div>
        {/* rail halves */}
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 0, height: 11,
          width: top === 'past' ? 3 : 2.5, background: top === 'past' ? 'var(--c-accent)' : top === 'future' ? 'var(--c-border-strong)' : 'transparent', borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 11, bottom: 0,
          width: bottom === 'past' ? 3 : 2.5, background: bottom === 'past' ? 'var(--c-accent)' : bottom === 'future' ? 'var(--c-border-strong)' : 'transparent', borderRadius: 2 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>{children}</div>
    </div>
  );
}

function Leg({ line, dir, dur, current }) {
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      <div style={{ width: RAIL, position: 'relative', flex: '0 0 auto' }}>
        {current ? (
          <>
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 0, bottom: 0, width: 3,
              backgroundImage: 'repeating-linear-gradient(180deg, var(--c-accent) 0 7px, transparent 7px 13px)', borderRadius: 2 }} />
            <div className="vb-train" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
              width: 24, height: 24, borderRadius: '50%', background: 'var(--c-accent)', color: 'var(--c-accent-ink)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3, boxShadow: '0 0 0 4px var(--c-bg)' }}>
              <IconTrain size={14} />
            </div>
          </>
        ) : (
          <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 0, bottom: 0, width: 2.5,
            background: 'var(--c-border-strong)', borderRadius: 2 }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: '6px 0 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--c-text)', whiteSpace: 'nowrap' }}>{line}</span>
          <span className="faint" style={{ fontSize: 13.5 }}>{dir}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 5 }}>
          <span className="muted tnum" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{dur}</span>
          {current && (
            <span className="badge badge-accent" style={{ height: 22 }}>
              <span className="vb-blink" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-accent)' }} />
              Jetzt unterwegs · +10 Min
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TimeLine({ plan, real, delay, platform }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 3 }}>
      <span className="tnum" style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap' }}>{real}</span>
      {delay != null && (
        <span className="tnum" style={{ fontSize: 13, color: delay > 0 ? 'var(--c-warn)' : 'var(--c-accent)', fontWeight: 600 }}>
          {delay > 0 ? `+${delay}` : 'pünktl.'}
        </span>
      )}
      {plan && <span className="faint tnum" style={{ fontSize: 13, textDecoration: 'line-through', whiteSpace: 'nowrap' }}>{plan}</span>}
      {platform && (
        <span className="badge badge-neutral" style={{ height: 22, marginLeft: 'auto' }}>
          <IconPlatform size={13} /> Gl {platform}
        </span>
      )}
    </div>
  );
}

function Transfer({ buffer, critical, next, nextPlatform }) {
  const nav = useNav();
  return (
    <div style={{
      marginTop: 10, padding: '11px 12px', borderRadius: 12,
      background: critical ? 'var(--c-warn-soft)' : 'var(--c-accent-soft)',
      display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ color: critical ? 'var(--c-warn)' : 'var(--c-accent)', display: 'flex' }}>
          {critical ? <IconAlert size={15} /> : <IconCheck size={15} />}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: critical ? 'var(--c-warn)' : 'var(--c-accent)', whiteSpace: 'nowrap' }}>
          Umstieg · Puffer {buffer} Min
        </span>
      </div>
      <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.4 }}>
        Weiter mit <strong style={{ color: 'var(--c-text)', fontWeight: 600 }}>{next}</strong> ab Gleis {nextPlatform}.
      </div>
      {critical && (
        <button className="linkbtn" onClick={() => nav.go('alternativen')} style={{ alignSelf: 'flex-start', padding: 0, color: 'var(--c-warn)', fontSize: 13.5 }}>
          Umstieg kritisch — Alternative ansehen →
        </button>
      )}
    </div>
  );
}

function MapPin({ x, y, variant, label, sub, side = 'right' }) {
  let dot;
  if (variant === 'current') dot = (
    <span className="vb-pulse" style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--c-accent)',
      color: 'var(--c-accent-ink)', boxShadow: '0 0 0 4px var(--c-subtle), 0 0 0 6px var(--c-accent-soft)',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconTrain size={12} /></span>
  );
  else if (variant === 'accent') dot = (
    <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--c-accent)', boxShadow: '0 0 0 4px var(--c-subtle)' }}></span>
  );
  else if (variant === 'dest') dot = (
    <span style={{ width: 19, height: 19, borderRadius: '50%', background: 'var(--c-card)', border: '2.5px solid var(--c-accent)',
      boxShadow: '0 0 0 4px var(--c-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-accent)' }}><IconPin size={11} /></span>
  );
  else dot = (
    <span style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--c-accent)', boxShadow: '0 0 0 3px var(--c-subtle)' }}></span>
  );
  return (
    <div style={{ position: 'absolute', left: x + '%', top: y + '%', transform: 'translate(-50%,-50%)',
      display: 'flex', alignItems: 'center', gap: 7, flexDirection: side === 'left' ? 'row-reverse' : 'row', zIndex: 2 }}>
      {dot}
      {label && (
        <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 9,
          padding: '4px 8px', boxShadow: 'var(--c-shadow)', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.2 }}>{label}</div>
          {sub && <div className="muted tnum" style={{ fontSize: 10.5, lineHeight: 1.25, marginTop: 1 }}>{sub}</div>}
        </div>
      )}
    </div>
  );
}

function MapView() {
  return (
    <div className="screen-body" style={{ paddingTop: 8, paddingBottom: 70, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        position: 'relative', width: '100%', height: 340, borderRadius: 16, overflow: 'hidden',
        border: '1px solid var(--c-border)', background: 'var(--c-subtle)',
        backgroundImage: 'linear-gradient(var(--c-border) 1px, transparent 1px), linear-gradient(90deg, var(--c-border) 1px, transparent 1px)',
        backgroundSize: '36px 36px',
      }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <polyline points="14,86 46,56 66,38 86,15" fill="none" stroke="var(--c-border-strong)" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <polyline points="14,86 33,67" fill="none" stroke="var(--c-accent)" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <MapPin x={14} y={86} variant="dot" label="Frankfurt (Main)" sub="ab 17:53" side="right" />
        <MapPin x={33} y={67} variant="current" label="Du bist hier" sub="ICE 1045 · +10 Min" side="left" />
        <MapPin x={46} y={56} variant="accent" label="Kassel Hbf" sub="Umstieg · 18:57" side="right" />
        <MapPin x={66} y={38} variant="dot" label="Northeim" sub="19:12" side="left" />
        <MapPin x={86} y={15} variant="dest" label="Göttingen" sub="Ziel · 19:24" side="left" />
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', paddingLeft: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }} className="muted">
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--c-accent)' }}></span> Aktuelle Position
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }} className="muted">
          <span style={{ width: 18, height: 0, borderTop: '2px dashed var(--c-border-strong)' }}></span> Restliche Route
        </span>
      </div>

      <div className="card" style={{ padding: '13px 14px', background: 'var(--c-subtle)', border: 'none', boxShadow: 'none', display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        <span className="muted" style={{ flex: '0 0 auto', marginTop: 1 }}><IconPin size={16} /></span>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
          Schematische Übersicht zur Orientierung. Die <strong style={{ color: 'var(--c-text)' }}>Timeline</strong> bleibt der genaue Fahrplan mit Zeiten und Puffern.
        </p>
      </div>
    </div>
  );
}

function ScreenCompanion() {
  const [tab, setTab] = React.useState('timeline');
  const TabBtn = ({ id, icon, children }) => (
    <button onClick={() => setTab(id)} style={{
      flex: 1, height: 38, border: 'none', borderRadius: 9, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
      fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,
      background: tab === id ? 'var(--c-card)' : 'transparent',
      color: tab === id ? 'var(--c-text)' : 'var(--c-muted)',
      boxShadow: tab === id ? 'var(--c-shadow)' : 'none', transition: 'background .15s, color .15s',
    }}>{icon}{children}</button>
  );
  return (
    <div className="vb-screen" style={{ position: 'relative' }}>
      <StatusBar />
      <SubAppBar eyebrow="Reisebegleiter" />

      {/* sticky-style header block */}
      <div style={{ padding: '8px 16px 14px', position: 'sticky', top: 0, zIndex: 5,
        background: 'linear-gradient(var(--c-bg) 78%, transparent)' }}>
        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
              <span className="accent tnum" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>+18 Min</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>schneller</span>
            </div>
            <p className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>als dein ursprünglicher Zug · Ankunft <strong className="tnum" style={{ color: 'var(--c-text)' }}>19:24</strong></p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingTop: 11, borderTop: '1px solid var(--c-border)' }}>
            <span style={{ color: 'var(--c-warn)', display: 'flex' }}><IconClock size={15} /></span>
            <span className="muted" style={{ fontSize: 13.5 }}>
              Gegenüber Fahrplan: <strong className="tnum" style={{ color: 'var(--c-warn)', fontWeight: 600 }}>+10 Min</strong> Verspätung
            </span>
          </div>
        </div>

        {/* next-step card */}
        <div className="card" style={{ marginTop: 10, padding: '13px 14px', borderColor: 'var(--c-accent)',
          display: 'flex', gap: 12, alignItems: 'flex-start', background: 'var(--c-card)' }}>
          <div style={{ flex: '0 0 auto', width: 38, height: 38, borderRadius: 10, background: 'var(--c-accent-soft)',
            color: 'var(--c-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconNow size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35 }}>
              In <span className="tnum">27 Min</span> in Kassel Hbf aussteigen
            </p>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.4, marginTop: 3 }}>
              Anschluss <strong style={{ color: 'var(--c-text)', fontWeight: 600 }}>RE 4321</strong> · Gleis 5 · Puffer 9 Min
            </p>
          </div>
        </div>

        {/* Timeline | Karte tabs */}
        <div style={{ display: 'flex', gap: 6, marginTop: 10, padding: 4, background: 'var(--c-subtle)', borderRadius: 12 }}>
          <TabBtn id="timeline" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="6" cy="6" r="1.6" /><circle cx="6" cy="12" r="1.6" /><circle cx="6" cy="18" r="1.6" /><path d="M11 6h8M11 12h8M11 18h5" /></svg>}>Timeline</TabBtn>
          <TabBtn id="karte" icon={<IconPin size={16} />}>Karte</TabBtn>
        </div>
      </div>

      {tab === 'karte' && <MapView />}
      {tab === 'timeline' && (
      <div className="screen-body" style={{ paddingTop: 6, paddingBottom: 70 }}>
        <Stop kind="past" top="none" bottom="past">
          <h3>Frankfurt (Main) Hbf</h3>
          <TimeLine real="ab 17:53" delay={null} platform="9" />
          <p className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>Eingestiegen</p>
        </Stop>

        <Leg line="ICE 1045" dir="Richtung Hamburg-Altona" dur="1:04 h" current />

        <Stop kind="current" top="past" bottom="future">
          <h3 className="accent">Kassel Hbf</h3>
          <TimeLine real="an 18:57" delay={0} platform="7" />
          <Transfer buffer="9" next="RE 4321" nextPlatform="5" />
        </Stop>

        <Leg line="RE 4321" dir="Richtung Northeim" dur="0:06 h" />

        <Stop kind="future" top="future" bottom="future">
          <h3>Northeim</h3>
          <TimeLine plan="19:11" real="an 19:12" delay={1} platform="2" />
          <Transfer buffer="3" critical next="ICE 1573" nextPlatform="1" />
        </Stop>

        <Leg line="ICE 1573" dir="Richtung Berlin Hbf" dur="0:09 h" />

        <Stop kind="dest" top="future" bottom="none">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <h3>Göttingen</h3>
            <span className="badge badge-accent"><IconPin size={12} /> Ziel</span>
          </div>
          <TimeLine real="an 19:24" delay={0} platform="4" />
        </Stop>
      </div>
      )}

      {/* floating jump-to-now */}
      {tab === 'timeline' && (
      <button className="vb-fab" aria-label="Zu Jetzt springen">
        <IconNow size={17} /> Jetzt
      </button>
      )}
    </div>
  );
}

Object.assign(window, { ScreenCompanion });
