/*
 * A tombstone for the service worker that used to live here.
 *
 * app.cyrix.in served the KPI app at the root for months, and vite-plugin-pwa
 * registered a worker at "/" in every browser that visited. That registration
 * does not go away when the domain starts serving the portal instead. The
 * browser keeps the old worker, keeps answering navigations out of its cache,
 * and shows people an app that is no longer at this address — with no error
 * and no hint that anything is stale.
 *
 * A service worker is only ever replaced by a newer worker at the same URL,
 * so this file has to exist, be reachable, and be served as JavaScript. It
 * installs, throws away everything the old one cached, unregisters itself,
 * and reloads the pages it was controlling — which then load the portal from
 * the network with nothing left in the way.
 *
 * There is deliberately no fetch handler. From the moment this activates,
 * every request goes to the network even if the steps below fail.
 *
 * Delete this eventually, but not soon. A browser that has not opened the
 * site since the cutover still carries the old worker, and this file is the
 * only thing that can clear it.
 */

self.addEventListener('install', () => {
  // Do not wait for the old worker's tabs to close. Those are the tabs with
  // the problem.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Everything in here was put there by the app that used to be at this
      // origin. None of it is ours, and none of it is wanted.
      const names = await caches.keys()
      await Promise.all(names.map((name) => caches.delete(name)))

      await self.registration.unregister()

      // Unregistering does not release pages already being controlled, so
      // without this someone sitting on a stale tab keeps seeing the old app
      // until they navigate by hand. Reload what was open.
      const windows = await self.clients.matchAll({ type: 'window' })
      for (const client of windows) client.navigate(client.url)
    })(),
  )
})
