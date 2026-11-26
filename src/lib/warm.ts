/**
 * Start loading a module before its tile is pressed (the user, 23 Nov: "faster opening").
 *
 * Every tile is a full page load of another app, and most of that wait is
 * the app's JavaScript and CSS. A mouse resting on a tile, a finger landing
 * on it, or keyboard focus reaching it is a strong hint it is about to be
 * opened, so this fetches that module's index.html, reads which files it
 * needs, and asks the browser to preload them. By the time the click lands
 * they are already in the browser's cache, and with the immutable cache
 * header on every /<module>/assets/ path (vercel.json) they stay there until
 * that module deploys again, so after the first time nothing is fetched at all.
 *
 * Light on purpose:
 *   - Once per module per page; a second hover does nothing.
 *   - Only the small HTML document and the module's own static files. No
 *     module code runs, so no database call is made and nothing counts
 *     against Supabase.
 *   - Skipped when the phone asks to save data, or the connection is 2G.
 */
const warmed = new Set<string>()

type NetInfo = { saveData?: boolean; effectiveType?: string }

export function warmModule(path: string) {
  if (warmed.has(path)) return
  warmed.add(path)
  const net = (navigator as Navigator & { connection?: NetInfo }).connection
  if (net?.saveData || /(^|-)2g$/.test(net?.effectiveType ?? '')) return

  const base = path.endsWith('/') ? path : `${path}/`
  void fetch(base, { credentials: 'same-origin', headers: { accept: 'text/html' } })
    .then(r => (r.ok ? r.text() : ''))
    .then(html => {
      if (!html) return
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const files = new Map<string, 'script' | 'style'>()
      doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]').forEach(s => files.set(s.getAttribute('src')!, 'script'))
      doc.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"][href]').forEach(l => files.set(l.getAttribute('href')!, 'script'))
      doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]').forEach(l => files.set(l.getAttribute('href')!, 'style'))
      for (const [href, kind] of files) {
        // Only this site's own files. A module's page could in principle
        // name somewhere else; that is not ours to fetch on its behalf.
        let url: URL
        try { url = new URL(href, location.origin + base) } catch { continue }
        if (url.origin !== location.origin) continue
        const link = document.createElement('link')
        if (kind === 'script') {
          link.rel = 'modulepreload'
        } else {
          link.rel = 'preload'
          link.as = 'style'
        }
        // The module loads these with crossorigin, so the preload must too or
        // the browser keeps two copies and uses neither.
        link.crossOrigin = ''
        link.href = url.href
        document.head.appendChild(link)
      }
    })
    .catch(() => { /* only a head start; opening the tile still works */ })
}

/** The person's first tile, once the browser has nothing better to do. */
export function warmWhenIdle(path: string) {
  const go = () => warmModule(path)
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(go, { timeout: 4000 })
  else window.setTimeout(go, 2500)
}
