import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ClipboardList, QrCode, Activity, LayoutGrid, LogOut, ArrowRight, Loader2,
} from 'lucide-react'
import { supabase, ecodeToEmail, type Module } from './lib/supabase'

/**
 * app.cyrix.in — sign in once, then pick a module.
 *
 * Everything this page knows comes from two calls: who is signed in, and
 * what my_modules() says they are offered. It holds no data of its own
 * and enforces nothing, which is the point. A tile is an offer; each
 * module still decides for itself who may do what once you are inside
 * it, so hiding a tile is never mistaken for a lock.
 */

/** The icon names the registry uses, resolved to real components. */
const ICONS: Record<string, typeof ClipboardList> = {
  ClipboardList, QrCode, Activity,
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) return <Splash />
  return session ? <Portal /> : <SignIn />
}

function Splash() {
  return (
    <div className="splash">
      <Loader2 className="spin" size={22} aria-label="Loading" />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function SignIn() {
  const [ecode, setEcode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: ecodeToEmail(ecode),
      password,
    })
    // The session listener in App swaps the screen; only failure lands here.
    if (error) {
      setError(
        error.message.includes('Invalid login credentials')
          ? 'Wrong employee code or password.'
          : error.message,
      )
      setBusy(false)
    }
  }

  return (
    <div className="split">
      <aside className="brand">
        <p className="wordmark">CYRIX<span>®</span></p>
        <div>
          <p className="kicker">One sign-in</p>
          <h2 className="brand-line">
            Everything you use,<br />in one place.
          </h2>
        </div>
        <p className="foot-note">India Operations</p>
      </aside>

      <main className="pane">
        <div className="form-wrap">
          <h1>Sign in to continue.</h1>
          <form onSubmit={submit} className="stack">
            {error && <p className="error" role="alert">{error}</p>}

            <label className="field">
              <span>Employee Code</span>
              <input
                value={ecode}
                onChange={e => setEcode(e.target.value.toUpperCase())}
                placeholder="E1042"
                autoComplete="username"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            <button type="submit" className="primary" disabled={busy}>
              {busy && <Loader2 className="spin" size={15} />}
              {busy ? 'Signing In' : 'Sign In'}
            </button>

            {/* Password recovery lives in KPI, which is the app that owns
                the employee record and knows the address on it. */}
            <a className="quiet-link" href="/kpi">Forgot your password?</a>
          </form>
        </div>
        <footer className="pane-foot">
          <span>Cyrix Healthcare</span>
          <span>© {new Date().getFullYear()}</span>
        </footer>
      </main>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Portal() {
  const [modules, setModules] = useState<Module[] | null>(null)
  const [name, setName] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [me, mods] = await Promise.all([
        supabase.from('employees').select('full_name, ecode').maybeSingle(),
        supabase.rpc('my_modules'),
      ])
      if (!alive) return
      if (me.data?.full_name) setName(me.data.full_name.trim().split(/\s+/)[0])
      if (mods.error) setFailed(true)
      else setModules((mods.data ?? []) as Module[])
    })()
    return () => { alive = false }
  }, [])

  return (
    <div className="portal">
      <header className="bar">
        <p className="wordmark small">CYRIX<span>®</span></p>
        <button className="icon-btn" onClick={() => supabase.auth.signOut()} title="Sign out">
          <LogOut size={17} />
          <span className="sr">Sign out</span>
        </button>
      </header>

      <main className="portal-main">
        <h1>{name ? `Hello, ${name}` : 'Hello'}</h1>
        <p className="sub">Pick where you are going.</p>

        {modules === null && !failed && (
          <div className="tiles">
            <div className="tile skeleton" /><div className="tile skeleton" />
          </div>
        )}

        {failed && (
          <p className="empty">
            Could not load your modules just now. Refresh, or tell HR if it keeps happening.
          </p>
        )}

        {modules?.length === 0 && (
          <p className="empty">
            No modules have been assigned to you yet. Ask HR to add them.
          </p>
        )}

        {modules && modules.length > 0 && (
          <div className="tiles">
            {modules.map(m => {
              const Icon = (m.icon && ICONS[m.icon]) || LayoutGrid
              return (
                <a key={m.code} className="tile" href={m.path}>
                  <span className="tile-icon"><Icon size={22} /></span>
                  <span className="tile-body">
                    <span className="tile-name">{m.name}</span>
                    {m.description && <span className="tile-desc">{m.description}</span>}
                  </span>
                  <ArrowRight className="tile-go" size={17} />
                </a>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
