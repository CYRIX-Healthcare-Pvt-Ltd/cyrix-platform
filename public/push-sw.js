/*
 * Notifications on the phone and the desktop (KPI 0154).
 *
 * Registered at "/" by the portal and by KPI, so one device has one
 * subscription for the whole platform. It does nothing else: no fetch
 * handler, so every page still comes from the network — and it replaces
 * whatever was registered at "/" before (see sw.js), which had no reason
 * to stay.
 *
 * The push function sends { title, body, url, tag }.
 */

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { body: event.data && event.data.text() } }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Cyrix', {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: { url: d.url || '/' },
    }),
  )
})

// Opens the page it is about: a Cyrix window already open goes there,
// otherwise a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const same = wins.find(w => w.url === url)
    if (same) return same.focus()
    const any = wins.find(w => new URL(w.url).origin === self.location.origin)
    if (any && 'navigate' in any) {
      try { const w = await any.navigate(url); if (w) return w.focus() } catch { /* not ours to steer */ }
    }
    return self.clients.openWindow(url)
  })())
})
