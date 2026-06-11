// proto.jsx — the live clickable prototype: one phone frame with a stack
// navigator, fade+slide transitions, and the filter bottom-sheet overlay.

const PROTO_ROUTES = {
  start: () => <ScreenStart />,
  alternativen: () => <ScreenAlternativen />,
  companion: () => <ScreenCompanion />,
  settings: () => <ScreenSettings />,
  sicherheit: () => <ScreenSicherheit />,
  sprache: () => <ScreenSprache />,
  leer: () => <ScreenLeer />,
};

function PrototypeApp() {
  const [stack, setStack] = React.useState(['start']);
  const [dir, setDir] = React.useState('fwd');
  const [sheet, setSheet] = React.useState(false);
  const route = stack[stack.length - 1];

  const nav = React.useMemo(() => ({
    live: true,
    route,
    canBack: stack.length > 1,
    go(r) { setDir('fwd'); setSheet(false); setStack(s => (s[s.length - 1] === r ? s : [...s, r])); },
    back() { setDir('back'); setSheet(false); setStack(s => (s.length > 1 ? s.slice(0, -1) : s)); },
    replace(r) { setStack(s => { const n = s.slice(0, -1); n.push(r); return n; }); },
    openSheet() { setSheet(true); },
    closeSheet() { setSheet(false); },
  }), [route, stack.length]);

  const applyFilter = (count) => {
    setSheet(false); setDir('fwd');
    setStack(s => {
      const top = s[s.length - 1];
      const target = count === 0 ? 'leer' : 'alternativen';
      if (top === target) return s;
      if (top === 'alternativen' || top === 'leer') { const n = s.slice(0, -1); n.push(target); return n; }
      return [...s, target];
    });
  };

  const Screen = PROTO_ROUTES[route] || PROTO_ROUTES.start;

  return (
    <NavContext.Provider value={nav}>
      <div style={{ position: 'relative', height: '100%', overflow: 'hidden', background: 'var(--c-bg)' }}>
        <div className="vb-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
          <div key={stack.length + '-' + route} className="vb-route"
            style={{ animationName: dir === 'back' ? 'vb-route-back' : 'vb-route-fwd', minHeight: '100%' }}>
            <Screen />
          </div>
        </div>

        {sheet && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 30 }}>
            <div className="vb-scrim" onClick={() => setSheet(false)}
              style={{ position: 'absolute', inset: 0, background: 'rgba(15,20,28,.42)' }}></div>
            <div className="vb-sheet" style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '94%', overflowY: 'auto',
              background: 'var(--c-card)', borderTopLeftRadius: 22, borderTopRightRadius: 22,
              boxShadow: '0 -8px 40px rgba(0,0,0,.22)', display: 'flex', flexDirection: 'column',
            }}>
              <FilterSheetInner onApply={applyFilter} />
            </div>
          </div>
        )}
      </div>
    </NavContext.Provider>
  );
}

Object.assign(window, { PrototypeApp });
