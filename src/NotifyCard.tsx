import { useEffect, useState } from 'react'
import { Bell, Check, Download, Loader2, X } from 'lucide-react'
import { supabase } from './lib/supabase'
import { enablePush, pushState, syncPush, type PushState } from './lib/push'
import { promptInstall } from './lib/pwa'
import { Steps, useRoute } from './InstallButton'

/**
 * After signing in: turn on notifications, and install the app (the user,
 * 10 Oct: "when login again, show an enable notification and install app
 * pop up, and don't show this again and remind me later also").
 *
 * Only here, on the home page after signing in — not in KPI, where it
 * would come up again on every visit (the user, 10 Oct). "Don't show
 * again" lasts until the month changes, then it asks once more.
 */
const NEVER = 'cyrix.prompt.never'
const LATER = 'cyrix.prompt.later'
const SHOWN = 'cyrix.prompt.shown'
const thisMonth = () => new Date().toISOString().slice(0, 7)
const get = (s: Storage, k: string) => { try { return s.getItem(k) } catch { return null } }
const put = (s: Storage, k: string, v: string) => { try { s.setItem(k, v) } catch { /* private window */ } }

export default function NotifyCard() {
  const [push, setPush] = useState<PushState>(() => pushState())
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState(false)
  const route = useRoute()
  const [closed, setClosed] = useState(() =>
    get(localStorage, NEVER) === thisMonth()
    || Number(get(localStorage, LATER) ?? 0) > Date.now()
    || get(sessionStorage, SHOWN) === '1')

  // Not while SW Admin has device notifications switched off (KPI 0161).
  const [pushOn, setPushOn] = useState<boolean | null>(null)
  useEffect(() => {
    void supabase.from('app_settings').select('value').eq('key', 'push_enabled').maybeSingle()
      .then(({ data }) => setPushOn(data?.value !== false), () => setPushOn(true))
  }, [])
  // Wherever it is already allowed, keep this device on for whoever is signed in.
  useEffect(() => { if (pushOn) void syncPush(supabase).catch(() => {}) }, [pushOn])

  const canInstall = route === 'prompt' || route === 'ios' || route === 'desktop-manual'
  const show = pushOn === true && !closed && (push === 'ask' || push === 'install-first' || canInstall)
  useEffect(() => { if (show) put(sessionStorage, SHOWN, '1') }, [show])
  if (!show) return null

  const later = () => { put(localStorage, LATER, String(Date.now() + 864e5)); setClosed(true) }
  const never = () => { put(localStorage, NEVER, thisMonth()); setClosed(true) }
  const allow = async () => {
    setBusy(true)
    try { setPush(await enablePush(supabase)) } catch { setPush(pushState()) } finally { setBusy(false) }
  }
  const install = async () => {
    if (route === 'prompt') await promptInstall()
    else setSteps(true)
  }

  return (
    <div className="sheet-shade" onClick={e => { if (e.target === e.currentTarget) later() }}>
      <div className="sheet prompt" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <div className="sheet-head">
          <h2 id="prompt-title">Get the most out of Cyrix</h2>
          <button type="button" className="icon-btn sheet-close" onClick={later} title="Close">
            <X size={16} /><span className="sr">Close</span>
          </button>
        </div>
        <p className="prompt-sub">Reminders, HR messages and your notifications.</p>

        <div className="prompt-row">
          <Bell size={16} aria-hidden />
          <span className="prompt-name">Notifications</span>
          {push === 'on' ? <span className="prompt-ok"><Check size={15} /> On</span>
            : push === 'ask' ? (
              <button type="button" className="primary prompt-btn" onClick={allow} disabled={busy}>
                {busy && <Loader2 size={14} className="spin" />} Allow
              </button>
            ) : push === 'install-first' ? <span className="prompt-note">Install the app first</span>
            : push === 'blocked' ? <span className="prompt-bad">Blocked</span>
            : <span className="prompt-note">Not in this browser</span>}
        </div>
        {push === 'blocked' && (
          <p className="prompt-help">Click the padlock beside the address, set <strong>Notifications</strong> to <strong>Allow</strong>, then reload.</p>
        )}

        {canInstall && (
          <div className="prompt-row">
            <Download size={16} aria-hidden />
            <span className="prompt-name">Install the app</span>
            <button type="button" className="secondary-btn prompt-btn" onClick={install}>Install</button>
          </div>
        )}

        <div className="prompt-foot">
          <button type="button" className="quiet-link prompt-never" onClick={never}>Don&rsquo;t show again</button>
          <button type="button" className="secondary-btn prompt-btn" onClick={later}>Remind me later</button>
        </div>
      </div>
      {steps && <Steps ios={route === 'ios'} onClose={() => setSteps(false)} />}
    </div>
  )
}
