import { useEffect, useRef, useState } from 'react'
import { Download, MonitorDown, Share, PlusSquare, Check, X, Loader2 } from 'lucide-react'
import {
  installRoute, alreadyInstalled, hasNativePrompt, promptInstall,
  subscribeToInstallability, type InstallRoute,
} from './lib/pwa'

/**
 * Install the app, from the top bar (the user, 7 Oct: "in module, ie
 * platform, add a install app button"): an icon between the light and
 * dark switch and sign out, on a phone and a desktop alike.
 *
 * Installs the whole platform — every module opens inside the one app —
 * the same app the address bar offers on KPI's pages. Gone where it is installed
 * already, and where the browser cannot install at all: a dead button is
 * worse than none.
 */
const useRoute = (): InstallRoute => {
  const [, bump] = useState(0)
  useEffect(() => subscribeToInstallability(() => bump(n => n + 1)), [])
  return installRoute({
    standalone: alreadyInstalled(),
    hasPrompt: hasNativePrompt(),
    ua: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints,
  })
}

export default function InstallButton() {
  const route = useRoute()
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState(false)

  if (route === 'installed' || route === 'unsupported') return null

  const click = async () => {
    if (route !== 'prompt') { setSteps(true); return }
    setBusy(true)
    await promptInstall()
    setBusy(false)
  }

  const Icon = busy ? Loader2 : route === 'desktop-manual' ? MonitorDown : Download
  return (
    <>
      <button type="button" className="icon-btn install-btn" onClick={click} disabled={busy} title="Install the app">
        <Icon size={17} className={busy ? 'spin' : undefined} aria-hidden />
        <span className="sr">Install the app</span>
      </button>
      {steps && <Steps ios={route === 'ios'} onClose={() => setSteps(false)} />}
    </>
  )
}

/** Where the browser's own install lives, for the browsers that give no button. */
function Steps({ ios, onClose }: { ios: boolean; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    close.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="sheet-shade" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <div className="sheet-head">
          <h2 id="install-title">{ios ? 'Add Cyrix to your Home Screen' : 'Install Cyrix'}</h2>
          <button ref={close} type="button" className="icon-btn sheet-close" onClick={onClose} title="Close">
            <X size={16} />
            <span className="sr">Close</span>
          </button>
        </div>

        {ios ? (
          <ol className="sheet-steps">
            <li><span className="sheet-n">1</span><Share size={16} aria-hidden />
              <span>Tap the <strong>Share</strong> button at the bottom of Safari</span></li>
            <li><span className="sheet-n">2</span><PlusSquare size={16} aria-hidden />
              <span>Scroll down and choose <strong>Add to Home Screen</strong></span></li>
            <li><span className="sheet-n">3</span><Check size={16} aria-hidden />
              <span>Tap <strong>Add</strong>, and open Cyrix from your home screen from now on</span></li>
          </ol>
        ) : (
          <p className="sheet-note">
            Click the install icon at the right-hand end of the address bar — a small
            screen with a downward arrow — then choose <strong>Install</strong>.
          </p>
        )}

        <p className="sheet-foot">
          One app with all your modules inside. It opens from your home screen,
          fills the whole screen, and keeps you signed in.
        </p>
      </div>
    </div>
  )
}
