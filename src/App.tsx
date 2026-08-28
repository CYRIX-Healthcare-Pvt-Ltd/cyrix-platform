import { useEffect, useState, type FormEvent } from 'react'
import Logo from './Logo'
import Avatar from './Avatar'
import ThemeToggle from './ThemeToggle'
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
        {/* `--shade` is pinned dark in both themes, so this panel does not
            follow the toggle and neither may the lockup on it. */}
        <Logo height={38} showSubtitle={false} onDark />
        <div>
          <p className="kicker">Cyrix Platform</p>
          <h2 className="brand-line">
            One account.<br />Every Cyrix tool.
          </h2>
          {/* Named rather than described. Somebody arriving here is
              looking for a thing they already use, and the fastest way
              to reassure them they are in the right place is to show it
              on the wall. What each person can actually open is decided
              after sign-in, not here. */}
          <ul className="brand-list">
            <li>KPI</li>
            <li>Spare Mapping</li>
            <li>BEMMP Dashboard</li>
          </ul>
        </div>
        <p className="foot-note">India Operations</p>
      </aside>

      <main className="pane">
        {/* Here too: this is the first screen anybody sees, and somebody
            who prefers dark should not have to sign in through a white
            page to reach the control that fixes it. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <ThemeToggle />
        </div>
        <div className="form-wrap">
          <h1>Sign in to Cyrix.</h1>
          {/* The employee code has not changed and neither has the
              password. Saying so is worth a line: this screen is new,
              and the first instinct on meeting a new login is that you
              need new credentials for it. */}
          <p className="lede">
            The same employee code and password you already use.
          </p>
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

            {/* Password recovery lives in KPI, which owns the employee
                record and knows which address is on it. One flow, not
                one per module. */}
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
  /** Name and photo together: the header shows both, the greeting one. */
  const [me, setMe] = useState<{ full_name: string; avatar: string | null } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Filter to this person explicitly. Selecting from employees without
      // a filter and trusting RLS to leave one row does not work: the
      // policy also exposes your manager and your direct reports, so
      // maybeSingle() sees several rows and returns null. Everybody with a
      // manager — nearly everybody — was greeted as nobody.
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth.user?.id
      const [me, mods] = await Promise.all([
        uid
          ? supabase.from('employees')
              // avatar comes along for the ride. It is a data URL on the
              // row itself rather than a file to go and fetch, so the
              // photo costs this query nothing extra to carry.
              .select('id, full_name, ecode, avatar')
              .eq('auth_user_id', uid).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.rpc('my_modules'),
      ])
      if (!alive) return
      if (me.data?.full_name) {
        setMe({ full_name: me.data.full_name.trim(), avatar: me.data.avatar ?? null })
      }
      if (mods.error) setFailed(true)
      else setModules((mods.data ?? []) as Module[])

      /*
       * Administrators go straight to the work.
       *
       * Neither admin role is appraised, so the tile page offers them one
       * tile they must click to reach the only screen they came for. KPI's
       * own routing already sends each of them to the right place from its
       * root, so this only has to get them into KPI.
       *
       * Once per session, and that is the important part: the Apps control
       * inside every module points back here, and forwarding on every visit
       * would make it a button that appears to do nothing. Coming back
       * deliberately shows the tiles; signing in fresh does not stop here.
       */
      if (!me.data?.id) return
      const roles = await supabase.from('user_roles')
        .select('role').eq('employee_id', me.data.id)
      if (!alive) return
      const isAdmin = (roles.data ?? []).some(
        r => r.role === 'hr_admin' || r.role === 'sw_admin')
      if (!isAdmin) return

      try {
        if (sessionStorage.getItem('cyrix.portal.forwarded') === '1') return
        sessionStorage.setItem('cyrix.portal.forwarded', '1')
      } catch {
        // Private windows and blocked site data throw rather than return
        // null. Showing the tiles is the safe outcome: one extra click
        // beats a redirect that cannot remember it already happened.
        return
      }
      window.location.assign('/kpi')
    })()
    return () => { alive = false }
  }, [])

  return (
    <div className="portal">
      <header className="bar">
        <Logo height={20} showSubtitle={false} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        {/* Who is signed in, shown the same way every module shows it. The
            portal has no profile page of its own — the employee record
            lives in KPI — so this identifies rather than links, and the
            name is hidden on a phone where the mark and three controls
            already fill the bar. */}
        {me && (
          <span className="who">
            <span className="who-name">{me.full_name}</span>
            <Avatar name={me.full_name} src={me.avatar} />
          </span>
        )}
        <ThemeToggle />
        <button
          className="icon-btn"
          onClick={() => {
            // Clear the once-per-session forward, or the next person to sign
            // in on this browser inherits a flag set for somebody else.
            try { sessionStorage.removeItem('cyrix.portal.forwarded') } catch { /* not available */ }
            supabase.auth.signOut()
          }}
          title="Sign out"
        >
          <LogOut size={17} />
          <span className="sr">Sign out</span>
        </button>
        </div>
      </header>

      <main className="portal-main">
        <h1>{me ? `Hello, ${me.full_name.split(/\s+/)[0]}` : 'Hello'}</h1>
        {/* States what the set is rather than instructing somebody to click
            one of three large obvious cards. It also answers the question
            the page actually raises — why this person sees three tiles and
            the colleague beside them sees one. */}
        <p className="sub">The modules assigned to you.</p>

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
                <a key={m.code} className="tile" data-module={m.code} href={m.path}>
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
