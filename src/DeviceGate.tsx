import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'
import { supabase } from './lib/supabase'
import { requestDeviceCode, submitDeviceCode } from './lib/passwordOtp'

/**
 * Already signed in on another device (0149; the user, 8 Oct): a code
 * goes to the email on record, and only once it is typed are the two ways
 * in offered — Log in, or Sign out from all devices and log in, which ends
 * every other sign-in and keeps this one. No email on record: no code can
 * be sent, and IT or HR adds one.
 */
export default function DeviceGate({ others, emailHint, onDone }: {
  others: number
  emailHint: string | null
  onDone: () => void
}) {
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'send' | 'keep' | 'signout' | null>(null)
  const asked = useRef(false)

  const send = async () => {
    setBusy('send'); setError(null)
    const r = await requestDeviceCode()
    setBusy(null)
    if (r.ok) setSent(`A code was sent to ${emailHint}.`)
    else setError(r.message)
  }

  useEffect(() => {
    if (emailHint && !asked.current) { asked.current = true; void send() }
    // Once, on arriving here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = async (choice: 'keep' | 'signout') => {
    setBusy(choice); setError(null)
    const r = await submitDeviceCode({ code: code.trim(), choice: choice === 'signout' ? 'signout_others' : 'keep' })
    setBusy(null)
    if (r.ok) onDone()
    else setError(r.message)
  }

  const ready = /^\d{6}$/.test(code.trim()) && !busy

  return (
    <div className="split">
      <aside className="brand">
        <Logo height={72} showTagline onDark />
        <div>
          <p className="kicker">Cyrix Platform</p>
          <h2 className="brand-line">One account.<br />Every Cyrix tool.</h2>
        </div>
      </aside>
      <main className="pane">
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <ThemeToggle />
        </div>
        <div className="form-wrap">
          <p className="eyebrow">Another device</p>
          <h1>Already signed in on {others} other device{others === 1 ? '' : 's'}.</h1>
          <div className="stack">
            {!emailHint ? (
              <p className="error" role="alert">
                There is no email address on your record, so no code can be sent. Ask IT
                (it_support@cyrix.in) or HR to add your official email.
              </p>
            ) : (
              <>
                {sent && <p className="notice" role="status">{sent}</p>}
                {error && <p className="error" role="alert">{error}</p>}
                <label className="field">
                  <span>Code</span>
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6 digits"
                    autoFocus
                  />
                </label>
                <button type="button" className="primary" disabled={!ready} onClick={() => void go('keep')}>
                  {busy === 'keep' && <Loader2 className="spin" size={15} />} Log in
                </button>
                <button type="button" className="secondary-btn" disabled={!ready} onClick={() => void go('signout')}>
                  {busy === 'signout' && <Loader2 className="spin" size={15} />} Sign out from all devices and log in
                </button>
                <button type="button" className="quiet-link" disabled={!!busy} onClick={() => void send()}>
                  {busy === 'send' ? 'Sending…' : 'Send a new code'}
                </button>
              </>
            )}
            <button type="button" className="quiet-link" disabled={!!busy && busy !== 'send'}
              onClick={() => void supabase.auth.signOut({ scope: 'local' })}>
              Cancel
            </button>
          </div>
        </div>
        <footer className="pane-foot">
          <span>Cyrix Healthcare</span>
          <span>© {new Date().getFullYear()}</span>
        </footer>
      </main>
    </div>
  )
}
