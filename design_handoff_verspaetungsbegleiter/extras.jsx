// extras.jsx — Filter-Sheet (4) + Einstellungen (5)
// Exported to window as ScreenFilter, ScreenSettings.

/* ----------------------------------------------------- shared controls */

function Toggle({ on: initial = false }) {
  const [on, setOn] = React.useState(initial);
  return (
    <button className={'switch' + (on ? ' on' : '')} aria-pressed={on}
      onClick={() => setOn(v => !v)}><span className="knob"></span></button>
  );
}

function Segmented({ options, value: initial, grow, onChange }) {
  const [value, setValue] = React.useState(initial);
  const pick = (o) => { setValue(o); onChange && onChange(o); };
  return (
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o} className={'chip' + (o === value ? ' active' : '')}
          style={grow ? { flex: '1 1 0', minWidth: 64, justifyContent: 'center' } : null}
          onClick={() => pick(o)}>{o}</button>
      ))}
    </div>
  );
}

function MultiChips({ options, value: initial }) {
  const [sel, setSel] = React.useState(new Set(initial));
  const toggle = (o) => setSel(prev => { const n = new Set(prev); n.has(o) ? n.delete(o) : n.add(o); return n; });
  return (
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o} className={'chip' + (sel.has(o) ? ' active' : '')} onClick={() => toggle(o)}>
          {sel.has(o) ? <IconCheck size={14} /> : null}{o}
        </button>
      ))}
    </div>
  );
}

function FilterBlock({ title, sub, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <h3 style={{ fontSize: 15.5 }}>{title}</h3>
        {sub && <p className="muted" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.4 }}>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/* ============================================================ SCREEN 4 */

function RobustnessBlock() {
  const [lvl, setLvl] = React.useState('Normal');
  const help = {
    'Aggressiv': 'Umstiege mit unter 5 Min Puffer werden zugelassen — maximaler Zeitgewinn, höheres Risiko.',
    'Normal': 'Mindestens rund 5 Min Puffer — guter Kompromiss aus Tempo und Verlässlichkeit.',
    'Vorsichtig': 'Mindestens rund 10 Min Puffer — entspannte, sichere Umstiege.',
  };
  return (
    <FilterBlock title="Puffer beim Umstieg" sub="Wie viel Reserve du beim Umsteigen mindestens willst.">
      <Segmented grow options={['Aggressiv', 'Normal', 'Vorsichtig']} value={lvl} onChange={setLvl} />
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 2, padding: '10px 12px', borderRadius: 10, background: 'var(--c-subtle)' }}>
        <span className="muted" style={{ flex: '0 0 auto', marginTop: 1 }}><IconShield size={15} /></span>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{help[lvl]}</p>
      </div>
    </FilterBlock>
  );
}

// The sheet body — reused by the static artboard AND the live prototype overlay.
function FilterSheetInner({ onApply }) {
  const [maxU, setMaxU] = React.useState('3');
  const count = maxU === '0' ? 0 : 3;
  return (
    <React.Fragment>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
        <span style={{ width: 38, height: 4, borderRadius: 999, background: 'var(--c-border-strong)' }}></span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px 0' }}>
        <h2 style={{ fontSize: 20 }}>Filter</h2>
        <button className="linkbtn" style={{ padding: 0 }} onClick={() => setMaxU('3')}>Zurücksetzen</button>
      </div>

      <div style={{ padding: '18px 18px 0', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 15.5 }}>Nur frühere Ankünfte</h3>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.4 }}>
              Zeigt nur Wege, die vor deinem aktuellen Zug ankommen.
            </p>
          </div>
          <Toggle on={true} />
        </div>

        <hr className="sep" />

        <FilterBlock title="Verkehrsmittel">
          <MultiChips options={['Fernverkehr', 'Regional', 'S-Bahn']} value={['Fernverkehr', 'Regional']} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
            <span style={{ flex: 1, fontSize: 14.5, fontWeight: 500 }}>Nur DB-Züge</span>
            <Toggle on={true} />
          </div>
        </FilterBlock>

        <hr className="sep" />

        <FilterBlock title="Maximale Umstiege">
          <Segmented grow options={['0', '1', '2', '3', 'egal']} value={'3'} onChange={setMaxU} />
        </FilterBlock>

        <hr className="sep" />

        <RobustnessBlock />
      </div>

      <div style={{ padding: 18, paddingTop: 22 }}>
        <button className="btn btn-primary" onClick={() => onApply && onApply(count)}>
          {count > 0 ? `${count} Verbindungen anzeigen` : 'Keine Treffer — Suche anpassen'}
        </button>
      </div>
    </React.Fragment>
  );
}

function ScreenFilter() {
  return (
    <div className="vb-screen" style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      {/* dimmed context behind the sheet */}
      <div style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
        <ScreenAlternativen />
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,20,28,.42)' }}></div>

      {/* bottom sheet */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: 'var(--c-card)', borderTopLeftRadius: 22, borderTopRightRadius: 22,
        boxShadow: '0 -8px 40px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column',
      }}>
        <FilterSheetInner />
      </div>
    </div>
  );
}

/* ============================================================ SCREEN 5 */

function SetRow({ label, sub, value, control, chevron, last, onClick }) {
  const clickable = chevron || onClick;
  return (
    <React.Fragment>
      <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', cursor: clickable ? 'pointer' : 'default' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{label}</span>
          {sub && <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.35 }}>{sub}</span>}
        </div>
        {value && <span className="muted" style={{ fontSize: 14.5, whiteSpace: 'nowrap' }}>{value}</span>}
        {control}
        {chevron && <span className="faint" style={{ display: 'flex', marginRight: -4 }}>
          <IconArrow size={18} /></span>}
      </div>
      {!last && <hr className="sep" style={{ marginLeft: 15 }} />}
    </React.Fragment>
  );
}

function SetGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-faint)', letterSpacing: '.04em',
        textTransform: 'uppercase', paddingLeft: 4 }}>{label}</span>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function ScreenSettings() {
  const nav = useNav();
  return (
    <div className="vb-screen">
      <StatusBar />
      <SubAppBar eyebrow="Einstellungen" />
      <div className="screen-body" style={{ display: 'flex', flexDirection: 'column', gap: 22, paddingTop: 8 }}>

        <SetGroup label="Reisepräferenzen">
          <SetRow label="Standard-Suchmodus" sub="Womit die App startet" value="Zugnummer" chevron />
          <SetRow label="Puffer beim Umstieg" sub="Wie viel Reserve standardmäßig" value="Normal" chevron onClick={() => nav.go('sicherheit')} />
          <SetRow label="Maximale Umstiege" value="egal" chevron />
          <SetRow label="Nur DB-Züge" control={<Toggle on={false} />} />
          <SetRow label="Barrierefreie Umstiege" sub="Aufzug / stufenfreier Wechsel" control={<Toggle on={false} />} last />
        </SetGroup>

        <SetGroup label="Benachrichtigungen">
          <SetRow label="Kritische Umstiege" sub="Warnen, wenn der Puffer knapp wird" control={<Toggle on={true} />} />
          <SetRow label="Bessere Verbindung gefunden" control={<Toggle on={true} />} />
          <SetRow label="Gleiswechsel & Ausfälle" control={<Toggle on={true} />} last />
        </SetGroup>

        <SetGroup label="Darstellung">
          <SetRow label="Dark Mode" sub="Folgt sonst dem System" control={<Toggle on={false} />} />
          <SetRow label="Sprache" value="Deutsch" chevron onClick={() => nav.go('sprache')} last />
        </SetGroup>

        <SetGroup label="Daten & Offline">
          <SetRow label="Letzte Reise offline speichern" control={<Toggle on={true} />} />
          <SetRow label="Datenschutz" chevron />
          <SetRow label="Impressum" chevron last />
        </SetGroup>

        <p className="faint" style={{ fontSize: 12, textAlign: 'center' }}>VerspätungsBegleiter · Version 1.4.0</p>
      </div>
    </div>
  );
}

/* ============================================ SCREEN 6 · Detail: Level */

function RadioRow({ title, sub, meta, selected, last }) {
  return (
    <React.Fragment>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 15px', cursor: 'pointer' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15.5, fontWeight: 600 }}>{title}</span>
            {meta && <span className="badge badge-neutral" style={{ height: 22 }}>{meta}</span>}
          </div>
          {sub && <span className="muted" style={{ fontSize: 13, lineHeight: 1.4 }}>{sub}</span>}
        </div>
        <span style={{
          flex: '0 0 auto', width: 22, height: 22, borderRadius: '50%', marginTop: 1,
          border: selected ? 'none' : '2px solid var(--c-border-strong)',
          background: selected ? 'var(--c-accent)' : 'transparent', color: 'var(--c-accent-ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{selected && <IconCheck size={14} />}</span>
      </div>
      {!last && <hr className="sep" style={{ marginLeft: 15 }} />}
    </React.Fragment>
  );
}

function ScreenSicherheit() {
  return (
    <div className="vb-screen">
      <StatusBar />
      <SubAppBar eyebrow="Puffer beim Umstieg" />
      <div className="screen-body" style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 8 }}>
        <div>
          <h2 style={{ fontSize: 20 }}>Puffer beim Umstieg</h2>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, marginTop: 6, maxWidth: '34ch' }}>
            Wie viel Reserve du beim Umsteigen mindestens brauchst. Mehr Puffer = sicherer, aber meist etwas langsamer.
          </p>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <RadioRow title="Aggressiv" meta="< 5 Min" sub="Maximaler Zeitgewinn — knappe Umstiege werden zugelassen." />
          <RadioRow title="Normal" meta="≥ 5 Min" sub="Guter Kompromiss aus Tempo und Verlässlichkeit." selected />
          <RadioRow title="Vorsichtig" meta="≥ 10 Min" sub="Nur Umstiege mit komfortablem Puffer." last />
        </div>
        <div className="card" style={{ padding: '13px 14px', background: 'var(--c-subtle)', border: 'none', boxShadow: 'none', display: 'flex', gap: 11, alignItems: 'flex-start' }}>
          <span className="muted" style={{ flex: '0 0 auto', marginTop: 1 }}><IconShield size={17} /></span>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
            Knappe Umstiege werden trotzdem angezeigt — aber als <strong style={{ color: 'var(--c-warn)' }}>Riskant</strong> markiert.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ============================================ SCREEN 7 · Detail: Sprache */

function LangRow({ name, native, selected, last }) {
  return (
    <React.Fragment>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', cursor: 'pointer' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: selected ? 600 : 500 }}>{name}</span>
          {native && <span className="faint" style={{ fontSize: 13 }}>{native}</span>}
        </div>
        {selected && <span className="accent" style={{ display: 'flex' }}><IconCheck size={18} /></span>}
      </div>
      {!last && <hr className="sep" style={{ marginLeft: 15 }} />}
    </React.Fragment>
  );
}

function ScreenSprache() {
  return (
    <div className="vb-screen">
      <StatusBar />
      <SubAppBar eyebrow="Sprache" />
      <div className="screen-body" style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 8 }}>
        <h2 style={{ fontSize: 20 }}>Sprache</h2>
        <div className="input" style={{ borderWidth: 1.5 }}>
          <span className="lead"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg></span>
          <span className="ph">Sprache suchen</span>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <LangRow name="Deutsch" native="Deutsch" selected />
          <LangRow name="Englisch" native="English" />
          <LangRow name="Französisch" native="Français" />
          <LangRow name="Italienisch" native="Italiano" />
          <LangRow name="Niederländisch" native="Nederlands" />
          <LangRow name="Polnisch" native="Polski" last />
        </div>
      </div>
    </div>
  );
}

/* ============================================ SCREEN 8 · Leer-Zustand */

function ScreenLeer() {
  const nav = useNav();
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

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
          gap: 14, padding: '24px 12px 8px' }}>
          <span style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--c-accent-soft)',
            color: 'var(--c-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconShield size={30} />
          </span>
          <h2 style={{ fontSize: 21, maxWidth: '18ch' }}>Aktuell keine schnellere Verbindung</h2>
          <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.55, maxWidth: '32ch' }}>
            Dein jetziger Zug ist gerade die beste Option. Wir suchen weiter und melden uns,
            sobald etwas Schnelleres auftaucht.
          </p>
          <span className="badge badge-accent" style={{ height: 28, padding: '0 12px' }}>
            <span className="vb-blink" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--c-accent)' }}></span>
            Live-Überwachung aktiv
          </span>
        </div>

        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Benachrichtigen, wenn schneller möglich</span>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.4, marginTop: 3 }}>
                Push, sobald eine frühere Ankunft auftaucht.
              </p>
            </div>
            <Toggle on={true} />
          </div>
          <hr className="sep" />
          <button className="btn btn-ghost" onClick={() => nav.openSheet()}><IconFilter size={17} /> Filter lockern</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenFilter, FilterSheetInner, ScreenSettings, ScreenSicherheit, ScreenSprache, ScreenLeer });
