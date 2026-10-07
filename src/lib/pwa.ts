/**
 * Getting Cyrix onto people's home screens.
 *
 * The whole platform installs as one app, "Cyrix", from the manifest in
 * public/manifest.webmanifest: its scope is the whole domain, so every
 * module a tile leads to opens inside the same installed window. KPI links
 * the same manifest, so installing from either place is the same app.
 *
 * The same logic as KPI's src/lib/pwa.ts. There is no forcing an install:
 * the browser owns that decision, so this works out which of four
 * situations somebody is in and asks in the only way that one allows.
 *
 *   prompt          Chrome/Edge has handed over its install dialog.
 *   ios             Safari never does. Share → Add to Home Screen, by hand.
 *   desktop-manual  Installable, but the browser keeps its own button in
 *                   the address bar rather than handing one over.
 *   unsupported     Firefox and anything locked down: no button at all.
 */

/** Chrome's install event. Not in lib.dom, so declared here. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallRoute = 'installed' | 'prompt' | 'ios' | 'desktop-manual' | 'unsupported'

export function installRoute(opts: {
  standalone: boolean
  hasPrompt: boolean
  ua: string
  /** iPadOS 13+ claims to be a Mac. Touch points are what give it away. */
  touchPoints?: number
}): InstallRoute {
  if (opts.standalone) return 'installed'
  if (opts.hasPrompt) return 'prompt'

  const ua = opts.ua
  const iPhone = /iPad|iPhone|iPod/.test(ua)
  const iPadPretendingToBeAMac = /Macintosh/.test(ua) && (opts.touchPoints ?? 0) > 1
  if (iPhone || iPadPretendingToBeAMac) {
    // Only Safari can add to the home screen; Chrome and Firefox on iOS
    // have no such entry in their Share menu.
    const realSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
    return realSafari ? 'ios' : 'unsupported'
  }

  // On a phone, no captured event means it is installed already or Chrome
  // has decided not to offer yet. Neither is worth a button.
  if (/Android|Mobile/.test(ua)) return 'unsupported'

  const chromium = /Chrome|Chromium|Edg\//.test(ua) && !/OPR\//.test(ua)
  return chromium ? 'desktop-manual' : 'unsupported'
}

/** Is this window the installed app? (Not: is the app on this device.) */
export function isInstalled(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      (navigator as { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const announce = () => listeners.forEach(fn => fn())

/**
 * Somebody who installed it and then followed a link lands in an ordinary
 * tab, where display-mode says nothing. getInstalledRelatedApps can tell,
 * because the manifest names itself under related_applications.
 */
async function askTheBrowserWhatIsInstalled(): Promise<void> {
  const nav = navigator as { getInstalledRelatedApps?: () => Promise<Array<{ platform?: string }>> }
  if (typeof nav.getInstalledRelatedApps !== 'function') return
  try {
    const apps = await nav.getInstalledRelatedApps()
    if (apps.some(a => a.platform === 'webapp')) { installed = true; announce() }
  } catch { /* not supported here; offering it is the safe failure */ }
}

/** Call once, before React mounts: beforeinstallprompt fires early and once. */
export function watchInstallability(): void {
  installed = isInstalled()
  if (!installed) void askTheBrowserWhatIsInstalled()

  window.addEventListener('beforeinstallprompt', e => {
    // Keeps Chrome's own mini-infobar away and the event for the button.
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    announce()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    announce()
  })
}

export function subscribeToInstallability(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export const hasNativePrompt = () => deferred !== null
export const alreadyInstalled = () => installed || isInstalled()

/** Chrome's dialog. The event is single-use, so it is dropped either way. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred
  if (!e) return 'unavailable'
  deferred = null
  try {
    await e.prompt()
    const { outcome } = await e.userChoice
    if (outcome === 'accepted') installed = true
    announce()
    return outcome
  } catch {
    announce()
    return 'unavailable'
  }
}
