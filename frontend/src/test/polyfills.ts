// Node.js 26 defines `localStorage` as an experimental undefined global.
// jsdom needs to override it; this polyfill ensures it's configurable first.
if (typeof globalThis.localStorage === 'undefined') {
  const _store: Record<string, string> = {}
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => _store[key] ?? null,
      setItem: (key: string, val: string) => {
        _store[key] = val
      },
      removeItem: (key: string) => {
        delete _store[key]
      },
      clear: () => {
        Object.keys(_store).forEach((k) => delete _store[k])
      },
      key: (i: number) => Object.keys(_store)[i] ?? null,
      get length() {
        return Object.keys(_store).length
      },
    },
  })
}
