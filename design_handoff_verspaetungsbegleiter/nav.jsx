// nav.jsx — tiny navigation context shared by the screens.
// In static artboards there's no provider, so useNav() returns no-ops and
// every screen still renders exactly as before. The interactive prototype
// (proto.jsx) provides a real implementation.

const NavContext = React.createContext(null);

const NAV_NOOP = {
  go() {}, back() {}, replace() {},
  openSheet() {}, closeSheet() {},
  canBack: false, route: null, live: false,
};

function useNav() {
  return React.useContext(NavContext) || NAV_NOOP;
}

Object.assign(window, { NavContext, useNav, NAV_NOOP });
