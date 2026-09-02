import { useState, type FormEvent, type ReactNode } from 'react'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import { requestOtp, submitOtp } from './lib/passwordOtp'
import { emailFeedback, isOfficialEmail, OFFICIAL_DOMAIN } from './lib/officialEmail'

/**
 * Proving it is your account before letting you take it back.
 *
 * This lives at the front door rather than inside KPI, where it used to
 * be. Somebody who cannot remember their password cannot get into any
 * module, so asking them to work out which one holds the reset was
 * asking the locked-out to know the floor plan. One account, one place
 * to recover it.
 *
 * The flow it replaced set the password back to the employee code, which
 * meant the only thing standing between somebody and a colleague's
 * account was knowing a number printed on their badge. Now a code goes
 * to the address on that person's record and nothing happens until it
 * comes back.
 *
 * Note what is NOT said on this screen. Whether that employee code
 * exists, whether the address matches, whether there is an address at
 * all — every one of those comes back as the same sentence, because
 * anything more specific turns this form into a way to find out who
 * works here. The server decides that; this only prints it.
 */
export default function ForgotPassword({ onBack }: { onBack: (ecode?: string) => void }) {
  const [ecode, setEcode] = useState('')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [sent, setSent] = useState(false)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const emailProblem = emailFeedback(email, touched)

  const send = async () => {
    const r = await requestOtp({ ecode: ecode.trim(), email: email.trim() })
    // Deliberately advances even when nothing was sent. Stopping here on
    // a wrong address is the same as saying "that address is wrong",
    // which is the thing this screen must never say.
    if (!r.ok && r.message) { setError(r.message); return }
    setSent(true)
    setNotice(r.message)
  }

  const finish = async () => {
    if (pw.length < 8) { setError('Use at least 8 characters.'); return }
    if (pw !== confirm) { setError('The two passwords do not match.'); return }
    if (pw.toLowerCase() === ecode.trim().toLowerCase()) {
      setError('Your new password cannot be your employee code.')
      return
    }
    const r = await submitOtp({ ecode: ecode.trim(), code: otp, password: pw })
    if (!r.ok) { setError(r.message); return }
    setDone(true)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null); setNotice(null)
    setBusy(true)
    try {
      await (sent ? finish() : send())
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="stack">
        <p className="notice" role="status">
          <strong>Password changed.</strong> Sign in as{' '}
          <strong>{ecode.trim().toUpperCase()}</strong> with your new password.
        </p>
        <button className="primary" onClick={() => onBack(ecode.trim().toUpperCase())}>
          Back to Sign In
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="stack">
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <Field
        label="Employee Code"
        value={ecode}
        onChange={v => setEcode(v.toUpperCase())}
        placeholder="E1042"
        autoFocus={!sent}
        uppercase
        disabled={sent}
      />

      <Field
        label="Official Email"
        type="email"
        value={email}
        onChange={v => { setEmail(v); if (touched) setTouched(false) }}
        placeholder={`you@${OFFICIAL_DOMAIN}`}
        disabled={sent}
        onBlur={() => setTouched(true)}
        error={sent ? null : emailProblem}
        hint={sent ? undefined : 'The email on your employee record. HR can tell you which one that is.'}
      />

      {sent && (
        <>
          <Field
            label="Code From Your Email"
            value={otp}
            onChange={v => setOtp(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoFocus
            hint="Six digits, good for 10 minutes."
          />
          {/* The eye goes on the one you are composing, not on the one
              that checks it. Revealing both would make the confirm field
              a copy-and-compare rather than the second, independent
              typing it exists to be. */}
          <Field
            label="New Password"
            type="password"
            reveal
            value={pw}
            onChange={setPw}
            autoComplete="new-password"
            hint="At least 8 characters."
          />
          <Field
            label="Confirm New Password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
        </>
      )}

      <button
        type="submit"
        className="primary"
        disabled={busy || (sent && otp.length < 6) || (!sent && !isOfficialEmail(email))}
      >
        {busy && <Loader2 className="spin" size={15} />}
        {busy ? 'Working' : sent ? 'Set My Password' : 'Email Me A Code'}
      </button>

      {sent && (
        <button
          type="button"
          className="quiet-link"
          onClick={() => { setSent(false); setOtp(''); setNotice(null); setError(null) }}
        >
          Use A Different Code Or Email
        </button>
      )}

      <button type="button" className="quiet-link" onClick={() => onBack()}>
        Back to Sign In
      </button>
    </form>
  )
}

/**
 * One underline field, the shape the sign-in beside it already uses.
 *
 * A local component rather than a shared one: the portal has exactly two
 * forms and they are both on this screen, so a component library for
 * them would be more machinery than the thing it holds.
 */
function Field({
  label, value, onChange, type = 'text', placeholder, autoComplete, autoFocus,
  uppercase, hint, disabled, error, onBlur, inputMode, reveal,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  autoComplete?: string
  autoFocus?: boolean
  uppercase?: boolean
  hint?: string
  /**
   * Answered already and not up for revision — the employee code and
   * email are what the emailed code was issued against, so letting them
   * change while it is being typed would only produce a code that no
   * longer matches anything.
   */
  disabled?: boolean
  /** Replaces the hint and turns the rule red. */
  error?: string | null
  /** Leaving the field is what counts as having finished typing in it. */
  onBlur?: () => void
  inputMode?: 'numeric'
  /** Offer an eye. Only for a password somebody is composing. */
  reveal?: boolean
}): ReactNode {
  const [shown, setShown] = useState(false)

  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input
          type={reveal && shown ? 'text' : type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          inputMode={inputMode}
          autoCapitalize={uppercase ? 'characters' : undefined}
          autoCorrect="off"
          spellCheck={false}
          required
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={!!error}
          style={{
            ...(uppercase ? { textTransform: 'uppercase' as const } : {}),
            ...(reveal ? {} : { paddingRight: 0 }),
          }}
        />
        {reveal && (
          <button
            type="button"
            className="reveal"
            onClick={() => setShown(s => !s)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            title={shown ? 'Hide password' : 'Show password'}
          >
            {shown ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </span>
      {/* The rule under the field is the whole visual language of this
          screen, so a problem is said with it rather than by adding a
          box. */}
      {error
        ? <span className="field-error">{error}</span>
        : hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}
