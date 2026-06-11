// screens.jsx — the three VerspätungsBegleiter screens
// Each renders inside a fixed-width (.vb) mobile frame. Exported to window.

const { useState } = React;

/* ---------------------------------------------------------------- shared */

function StatusBar() {
  return (
    <div className="statusbar tnum">
      <span>18:30</span>
      <span className="dots">
        <span></span><span></span><span></span>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor" style={{ opacity: .9 }}>
          <rect x="0" y="7" width="3" height="5" rx="1" /><rect x="4.5" y="4.5" width="3" height="7.5" rx="1" />
          <rect x="9" y="2" width="3" height="10" rx="1" /><rect x="13.5" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="22" height="12" viewBox="0 0 22 12" fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="0.5" y="0.5" width="18" height="11" rx="2.5" />
          <rect x="2.5" y="2.5" width="12" height="7" rx="1" fill="currentColor" />
          <rect x="20" y="4" width="1.5" height="4" rx="0.75" fill="currentColor" />
        </svg>
      </span>
    </div>
  );
}

function AppBar({ title }) {
  const nav = useNav();
  return (
    <div className="appbar">
      <div className="brand">
        <div className="mark"><i></i></div>
        <span className="name">{title || 'VerspätungsBegleiter'}</span>
      </div>
      <button className="iconbtn" aria-label="Einstellungen" onClick={() => nav.go('settings')}><IconSettings size={20} /></button>
    </div>
  );
}

function SubAppBar({ eyebrow, settings = true }) {
  const nav = useNav();
  return (
    <div className="appbar" style={{ paddingTop: 6 }}>
      <button className="iconbtn" aria-label="Zurück" style={{ marginLeft: -8 }} onClick={() => nav.back()}><IconBack size={20} /></button>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-muted)', letterSpacing: '.02em' }}>{eyebrow}</span>
      {settings
        ? <button className="iconbtn" aria-label="Einstellungen" onClick={() => nav.go('settings')}><IconSettings size={19} /></button>
        : <span style={{ width: 38 }}></span>}
    </div>
  );
}

/* ============================================================ SCREEN 1 */

function ScreenStart() {
  const nav = useNav();
  return (
    <div className="vb-screen">
      <StatusBar />
      <AppBar />
      <div className="screen-body" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          <span className="badge badge-accent" style={{ alignSelf: 'flex-start' }}>
            <IconBolt size={13} /> Live-Umleitung
          </span>
          <h1 style={{ maxWidth: '15ch' }}>Schneller ans Ziel — ab deinem jetzigen Zug.</h1>
          <p className="muted" style={{ fontSize: 15, lineHeight: 1.5, maxWidth: '32ch' }}>
            Wir überwachen deine Verbindung und finden Wege, die früher ankommen — auch mit mehr Umstiegen.
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 2 }}>
            <span className="faint" style={{ flex: '0 0 auto', marginTop: 1 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></svg>
            </span>
            <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.45, maxWidth: '34ch' }}>
              Fokus: schnellere Ankunft — kein Ticketverkauf, keine offizielle DB-App.
            </p>
          </div>
        </div>

        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field">
            <label htmlFor="">Zugnummer</label>
            <div className="input focus">
              <span className="lead"><IconTrain size={18} /></span>
              <span className="val tnum">ICE 1045</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="">Zielbahnhof</label>
            <div className="input">
              <span className="lead"><IconPin size={18} /></span>
              <span className="val">Göttingen</span>
            </div>
          </div>

          <hr className="sep" />

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Ich sitze in diesem Zug</span>
              <span className="muted" style={{ fontSize: 13, lineHeight: 1.4 }}>
                Wir nehmen deine aktuelle Position als Startpunkt.
              </span>
            </div>
            <button className="switch on" aria-pressed="true"><span className="knob"></span></button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={() => nav.go('alternativen')}>Beste Verbindung jetzt finden</button>
          <button className="linkbtn">Stattdessen Start- und Zielbahnhof eingeben</button>
        </div>

      </div>
    </div>
  );
}

/* ============================================================ SCREEN 2 */

const ALTERNATIVES = [
  {
    gain: '+18 Min', headline: 'früher am Ziel', eta: '19:24',
    changes: '2 Umstiege', buffer: 'min. Puffer 3 Min',
    badges: [{ t: 'Schnellste', k: 'accent', i: IconBolt }, { t: 'Riskant', k: 'warn', i: IconAlert }],
    accent: true,
  },
  {
    gain: '+12 Min', headline: 'früher am Ziel', eta: '19:30',
    changes: '1 Umstieg', buffer: 'min. Puffer 11 Min',
    badges: [{ t: 'Am stabilsten', k: 'accent', i: IconShield }, { t: 'Nur DB', k: 'neutral' }],
  },
  {
    gain: '+6 Min', headline: 'früher am Ziel', eta: '19:36',
    changes: '3 Umstiege', buffer: 'min. Puffer 7 Min',
    badges: [{ t: 'Nur DB', k: 'neutral' }],
  },
];

function AltCard({ a }) {
  const nav = useNav();
  return (
    <div className="card" onClick={() => nav.go('companion')} style={{
      padding: 16, display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer',
      ...(a.accent ? { borderColor: 'var(--c-accent)', boxShadow: 'var(--c-shadow-lift)' } : {}),
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
          <span className="accent tnum" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{a.gain}</span>
          <span className="muted" style={{ fontSize: 15, fontWeight: 500, whiteSpace: 'nowrap' }}>{a.headline}</span>
        </div>
        <span className="faint" style={{ display: 'flex', alignItems: 'center', flex: '0 0 auto' }}><IconArrow size={20} /></span>
      </div>

      <div className="muted tnum" style={{ fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
          <IconClock size={15} /> Ankunft <strong style={{ color: 'var(--c-text)', fontWeight: 600 }}>{a.eta}</strong>
        </span>
        <span className="faint">·</span><span style={{ whiteSpace: 'nowrap' }}>{a.changes}</span>
        <span className="faint">·</span><span style={{ whiteSpace: 'nowrap' }}>{a.buffer}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {a.badges.map((b, i) => (
          <span key={i} className={`badge badge-${b.k}`}>
            {b.i ? <b.i size={13} /> : null}{b.t}
          </span>
        ))}
      </div>
    </div>
  );
}

function FilterRow() {
  const nav = useNav();
  const [active, setActive] = useState(['Nur DB', 'max. 3 Umstiege', 'Puffer: Normal']);
  const remove = (f) => setActive(prev => prev.filter(x => x !== f));
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <button className="chip filter" onClick={() => nav.openSheet()}>
        <IconFilter size={15} /> Filter
        {active.length > 0 && (
          <span className="tnum" style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
            background: 'var(--c-accent)', color: 'var(--c-accent-ink)', fontSize: 11.5, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{active.length}</span>
        )}
      </button>
      {active.map(f => (
        <button key={f} className="chip active" onClick={() => remove(f)} style={{ paddingRight: 8 }}>
          {f}
          <span style={{ display: 'flex', opacity: .7 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </span>
        </button>
      ))}
    </div>
  );
}

function ScreenAlternativen() {
  return (
    <div className="vb-screen">
      <StatusBar />
      <SubAppBar eyebrow="Alternativen" />
      <div className="screen-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        <div className="card" style={{ padding: '13px 15px', background: 'var(--c-subtle)', border: 'none', boxShadow: 'none', display: 'flex', gap: 11, alignItems: 'flex-start' }}>
          <span className="muted" style={{ marginTop: 1, flex: '0 0 auto' }}><IconClock size={17} /></span>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
            Dein aktueller Zug bringt dich voraussichtlich um{' '}
            <strong className="tnum" style={{ color: 'var(--c-text)', fontWeight: 600 }}>19:42</strong> ans Ziel.
          </p>
        </div>

        <h2>Bessere Verbindungen gefunden</h2>

        <FilterRow />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ALTERNATIVES.map((a, i) => <AltCard key={i} a={a} />)}
        </div>

        <p className="faint" style={{ fontSize: 12.5, textAlign: 'center', lineHeight: 1.4 }}>
          Verbindungen werden alle 30&nbsp;Sekunden neu berechnet.
        </p>
      </div>
    </div>
  );
}

Object.assign(window, { StatusBar, AppBar, SubAppBar, ScreenStart, ScreenAlternativen });
