/*
  Browser storage that cannot crash the app (15 Oct: a phone showed "Cyrix cannot start.
  Failed to read the 'localStorage' property"). Some in-app browsers and strict privacy settings
  throw on the mere mention of localStorage; there everything falls back to memory for the visit.
*/
function memory(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: k => (m.has(k) ? m.get(k)! : null),
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => { m.delete(k) },
    setItem: (k, v) => { m.set(k, String(v)) },
  }
}
function pick(name: 'localStorage' | 'sessionStorage'): Storage {
  try {
    const s = window[name]
    const probe = '__cyra_probe__'
    s.setItem(probe, '1'); s.removeItem(probe)
    return s
  } catch {
    return memory()
  }
}
export const local: Storage = pick('localStorage')
export const session: Storage = pick('sessionStorage')
