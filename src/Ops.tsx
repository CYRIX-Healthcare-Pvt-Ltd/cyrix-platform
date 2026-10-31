import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, GitCommitHorizontal, Rocket, BellRing,
} from 'lucide-react'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'
import { supabase } from './lib/supabase'
import './ops.css'

/**
 * app.cyrix.in/ops — every app at once, for the people who run them (KPI 0227; the user, 30 Oct).
 *
 * Two sources, and the page never mixes up which is which:
 *  - ops_overview(), asked with this session. Accounts, sign-ins and activity from the shared database. The
 *    database refuses anyone who is not an Ops admin, so this page hiding itself is a courtesy, not the lock.
 *  - /api/ops, for what a browser cannot reach: pinging other origins, Vercel, GitHub and CYRA's own database.
 *    It asks the same is_ops_admin() with the same token before answering.
 *
 * A source that is not set up yet says so in its own panel rather than leaving it blank, because an empty
 * error list and an error list nobody can read look exactly alike.
 *
 * It keeps itself current (the user, 31 Oct: "make it auto"): the quick sources every minute while the tab is
 * on screen, and everything again when somebody comes back to it. Deploys, commits, usage and AI cost move
 * slowly and cost a GitHub or Vercel call each, so they ride along every five minutes. A refresh never blanks
 * a panel, and one that fails keeps what it last showed rather than swapping good figures for an error.
 */

type Days = 7 | 30 | 90

interface Uptime {
  since: string
  first_check: string | null
  targets: { id: string; name: string; group: string; checks: number; up: number; uptime: number | null; avg_ms: number | null; down_now: boolean }[]
  incidents: { target: string; started_at: string; ended_at: string | null; problem: string | null; minutes: number }[]
}

/** Every app's browser errors (KPI 0230), grouped by message in the database as they arrive. */
interface AppErrors {
  total: number
  by_app: { app: string; errors: number; messages: number; people: number }[]
  by_day: { day: string; errors: number }[]
  groups: { app: string; message: string; route: string | null; release: string | null; stack: string | null;
            count: number; people: number; first: string; last: string }[]
}

interface Overview {
  since: string
  accounts: { total: number; signed_in_1d: number; signed_in_7d: number; signed_in_30d: number; never: number }
  signins_by_day: { day: string; users: number }[]
  grants: { code: string; name: string; active: boolean; users: number }[]
  activity_by_day: { day: string; module: string; events: number }[]
  active_by_module: { module: string; users: number; events: number }[]
  top_actions: { module: string; action: string; events: number }[]
}
interface Check { id: string; name: string; group: string; ok: boolean; status: number | null; ms: number; problem?: string }
interface Deploy { project: string; state: string; at: string; message: string; sha: string; author: string | null }
interface Commit { repo: string; sha: string; at: string; message: string; author: string | null; url: string }
interface ErrGroup { source: string; kind: string; message: string; routes: string[]; count: number; last: string; statuses: number[] }
interface Spend { key: string; calls: number; cost: number; tokens: number }

type HealthData = { at: string; checks: Check[] }
type DeploysData = { deploys: Deploy[] }
type ChangesData = { repos: { repo: string; commits: number; failed: string | number | null }[]; commits: Commit[] }
type ErrorsData = { total: number; truncated: boolean; by_day: { day: string; errors: number }[]; groups: ErrGroup[] }
type AiData = { cost: number; calls: number; unmetered: string[]; by_day: Spend[]; by_model: Spend[]; by_route: Spend[] }

/** Pulse's own view of itself (Pulse 1.12.0, GET /pulse/api/ops/summary): what only cyrix-svc01 can see. */
interface PulseData {
  sync: { job: string; every_hours: number; age_hours: number | null; late: boolean }[]
  backups: { count: number; total_bytes: number; newest: { name: string; size_bytes: number } | null; age_hours: number | null; late: boolean; scheduled_hour_ist: number }
  disk: { total_bytes: number; free_bytes: number; free_pct: number | null } | null
  ai_chat: { day: string; questions: number; people: number }[]
  backup_failures: { at: string; by: string; file: string | null }[]
  problems: string[]
}

type Part<T> = { state: 'loading' } | { state: 'off' } | { state: 'failed'; error: string } | { state: 'ok'; data: T }

const MODULE_NAMES: Record<string, string> = {
  portal: 'Portal', cyra: 'Cyra Assist', pulse: 'Pulse', kpi: 'KPI', spare: 'Spare Mapping', bemmp: 'BEMMP', revive: 'Revive Lab', travel: 'Travel Expense', tasks: 'My Task',
}

async function api<T>(part: string, days: number): Promise<Part<T>> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch(`/api/ops?part=${part}&days=${days}`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
    })
    const body = await r.json().catch(() => null)
    if (!r.ok) return { state: 'failed', error: body?.error ?? `Answered ${r.status}` }
    if (body?.configured === false) return { state: 'off' }
    if (body?.failed) return { state: 'failed', error: body.failed }
    return { state: 'ok', data: body as T }
  } catch {
    return { state: 'failed', error: 'Could not reach /api/ops' }
  }
}

const QUICK_MS = 60_000
const SLOW_MS = 5 * 60_000

/** Same origin: app.cyrix.in/pulse/ is a rewrite to cyrix-svc01, so the portal's own session goes straight through. */
async function pulseSummary(): Promise<Part<PulseData>> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch('/pulse/api/ops/summary', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
    if (r.status === 404) return { state: 'off' }
    const body = await r.json().catch(() => null)
    if (!r.ok) return { state: 'failed', error: body?.detail ?? `Pulse answered ${r.status}` }
    return { state: 'ok', data: body as PulseData }
  } catch {
    return { state: 'failed', error: 'Could not reach Pulse' }
  }
}

const fmtBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`
const fmtAge = (h: number | null) => h === null ? 'never' : h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`

const fmtInt = (n: number) => n.toLocaleString('en-IN')
const fmtUsd = (n: number) => `$${n.toFixed(2)}`
const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 129600) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const SECTIONS = [['status', 'Status'], ['uptime', 'Uptime'], ['errors', 'Errors'], ['usage', 'Usage'], ['ai', 'AI cost'], ['pulse', 'Pulse'], ['changes', 'Changes']] as const
const shortDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/**
 * Every day in the window, so a day with nothing on it is a gap in the chart and not a missing bar.
 * Days are India days (KPI 0228), whatever the viewer's clock says: the database buckets by Asia/Kolkata too,
 * and UTC days made "today" read 0 for the first five and a half hours of every morning.
 */
const istDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
function fillDays(days: number, values: Map<string, number>) {
  const out: { day: string; value: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const key = istDay(Date.now() - i * 86_400_000)
    out.push({ day: key, value: values.get(key) ?? 0 })
  }
  return out
}

export default function Ops() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [days, setDays] = useState<Days>(30)
  const [updated, setUpdated] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const [overview, setOverview] = useState<Part<Overview>>({ state: 'loading' })
  const [uptime, setUptime] = useState<Part<Uptime>>({ state: 'loading' })
  const [health, setHealth] = useState<Part<HealthData>>({ state: 'loading' })
  const [deploys, setDeploys] = useState<Part<DeploysData>>({ state: 'loading' })
  const [changes, setChanges] = useState<Part<ChangesData>>({ state: 'loading' })
  const [errors, setErrors] = useState<Part<ErrorsData>>({ state: 'loading' })
  const [appErrors, setAppErrors] = useState<Part<AppErrors>>({ state: 'loading' })
  const [ai, setAi] = useState<Part<AiData>>({ state: 'loading' })
  const [pulse, setPulse] = useState<Part<PulseData>>({ state: 'loading' })

  useEffect(() => {
    supabase.rpc('is_ops_admin').then(r => setAllowed(r.data === true), () => setAllowed(false))
  }, [])

  const daysNow = useRef(days)
  daysNow.current = days
  const lastLoad = useRef(0)
  const lastSlow = useRef(0)

  /** reset: blank every panel first (a new period). slow: ask the slow sources too. */
  const load = useCallback((reset: boolean, slow: boolean) => {
    const d = days
    lastLoad.current = Date.now()
    if (slow) lastSlow.current = Date.now()
    // Drop answers for a period nobody is looking at any more, and never trade good figures for a failed refresh.
    const keep = <T,>(fn: React.Dispatch<React.SetStateAction<Part<T>>>) => (p: Part<T>) => {
      if (daysNow.current !== d) return
      fn(prev => (!reset && p.state === 'failed' && prev.state === 'ok') ? prev : p)
    }
    const rpc = <T,>(fn: React.Dispatch<React.SetStateAction<Part<T>>>, name: string, args: Record<string, number>, offWhenMissing = true) =>
      supabase.rpc(name, args).then(
        r => keep(fn)(r.error ? { state: offWhenMissing && r.error.code === 'PGRST202' ? 'off' : 'failed', error: r.error.message } as Part<T>
                              : { state: 'ok', data: r.data as T }),
        () => keep(fn)({ state: 'failed', error: 'Could not reach the database' }))

    if (reset) {
      for (const fn of [setOverview, setUptime, setHealth, setDeploys, setChanges, setErrors, setAppErrors, setAi, setPulse] as
                       React.Dispatch<React.SetStateAction<Part<unknown>>>[]) fn({ state: 'loading' })
    }
    const jobs: PromiseLike<unknown>[] = [
      rpc(setAppErrors, 'ops_errors', { p_days: Math.min(d, 90) }),
      rpc(setUptime, 'ops_uptime', { p_days: Math.min(d, 90) }),
      api<HealthData>('health', 1).then(keep(setHealth)),
      api<ErrorsData>('errors', d).then(keep(setErrors)),
    ]
    if (slow) {
      jobs.push(
        rpc(setOverview, 'ops_overview', { p_days: d }, false),
        api<DeploysData>('deploys', d).then(keep(setDeploys)),
        api<ChangesData>('changes', d).then(keep(setChanges)),
        api<AiData>('ai', d).then(keep(setAi)),
        pulseSummary().then(keep(setPulse)),
      )
    }
    return Promise.allSettled(jobs).then(() => { if (daysNow.current === d) setUpdated(Date.now()) })
  }, [days])

  useEffect(() => { if (allowed) void load(true, true) }, [allowed, load])

  // Every minute while the tab is on screen; at once on coming back to it after a while away.
  useEffect(() => {
    if (!allowed) return
    const due = () => Date.now() - lastSlow.current >= SLOW_MS
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(false, due())
    }, QUICK_MS)
    const back = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current >= 30_000) void load(false, due())
    }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [allowed, load])

  const refreshNow = () => {
    setBusy(true)
    void load(false, true).finally(() => setBusy(false))
  }

  if (allowed === null) return <div className="splash"><Loader2 className="spin" size={22} aria-label="Loading" /></div>

  return (
    <div className="portal ops">
      <header className="bar">
        <a href="/" className="ops-back" title="Back to your modules"><ArrowLeft size={17} /><Logo height={30} /></a>
        <ThemeToggle />
      </header>

      <main className="ops-main">
        {!allowed ? (
          <p className="empty">This page is for the Ops admins. Ask the SW admin if you need it.</p>
        ) : (
          <>
            <div className="ops-head">
              <div>
                <h1>Ops</h1>
                <p className="sub">Every Cyrix app: up or down, what broke, who used it, what shipped, and what the AI cost.</p>
              </div>
              <div className="ops-controls">
                <div className="ops-seg" role="group" aria-label="Period">
                  {([7, 30, 90] as Days[]).map(d => (
                    <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>
                  ))}
                </div>
                <button className="icon-btn" title="Check again now" onClick={refreshNow} disabled={busy}>
                  <RefreshCw size={16} className={busy ? 'spin' : undefined} />
                </button>
              </div>
            </div>
            <p className="ops-live" aria-live="polite">
              <span className="ops-live-dot" aria-hidden="true" />
              {updated ? `Updated ${clock(updated)}` : 'Loading'} · refreshes every minute while open
            </p>

            <nav className="ops-jump" aria-label="Sections">
              {SECTIONS.map(([id, name]) => <a key={id} href={`#${id}`}>{name}</a>)}
            </nav>

            <Attention health={health} uptime={uptime} errors={errors} appErrors={appErrors} deploys={deploys} ai={ai} pulse={pulse} />
            <StatusPanel health={health} deploys={deploys} />
            {/* Side by side on a wide screen, one column below that. */}
            <div className="ops-pair">
              <UptimePanel uptime={uptime} days={days} />
              <ErrorsPanel errors={errors} appErrors={appErrors} days={days} />
            </div>
            <div className="ops-pair">
              <UsagePanel overview={overview} days={days} />
              <AiPanel ai={ai} days={days} />
            </div>
            <PulsePanel pulse={pulse} />
            <ChangesPanel changes={changes} deploys={deploys} />
          </>
        )}
      </main>
    </div>
  )
}

/* ---- panels --------------------------------------------------------------------------------------------- */

function Panel({ id, title, note, children }: { id?: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="ops-panel" id={id}>
      <div className="ops-panel-head"><h2>{title}</h2>{note && <span className="ops-note">{note}</span>}</div>
      {children}
    </section>
  )
}

function Waiting<T>({ part, off, children }: { part: Part<T>; off: string; children: (data: T) => React.ReactNode }) {
  if (part.state === 'loading') return <div className="ops-skeleton" />
  if (part.state === 'off') return <p className="ops-off">{off}</p>
  if (part.state === 'failed') return <p className="ops-failed"><AlertTriangle size={15} /> {part.error}</p>
  return <>{children(part.data)}</>
}

/**
 * The first thing on the page: what needs somebody now, worked out from the panels below. Without it the page
 * showed everything and pointed at nothing — Cyra Assist ran out of OpenAI credit for two weeks with every
 * failure listed in the Errors panel, three screens down, and nobody was told. Each line links to its panel.
 */
interface Flag { level: 'bad' | 'warn'; text: string; detail?: string; href: string }

function Attention({ health, uptime, errors, appErrors, deploys, ai, pulse }: {
  health: Part<HealthData>; uptime: Part<Uptime>; errors: Part<ErrorsData>; appErrors: Part<AppErrors>
  deploys: Part<DeploysData>; ai: Part<AiData>; pulse: Part<PulseData>
}) {
  const flags = useMemo(() => attentionFlags(health, uptime, errors, appErrors, deploys, ai, pulse), [health, uptime, errors, appErrors, deploys, ai, pulse])
  const settled = [health, uptime, errors, appErrors].every(p => p.state !== 'loading')
  if (!settled && flags.length === 0) return <div className="ops-attn"><div className="ops-skeleton ops-skeleton-thin" /></div>
  if (flags.length === 0) {
    return <p className="ops-attn is-clear"><CheckCircle2 size={17} className="ok" /> Nothing needs you right now.</p>
  }
  return (
    <section className={flags.some(f => f.level === 'bad') ? 'ops-attn' : 'ops-attn is-warn'} aria-labelledby="ops-attn-h">
      <h2 id="ops-attn-h"><BellRing size={16} /> Needs attention</h2>
      <ul>
        {flags.map((f, i) => (
          <li key={i} className={f.level === 'bad' ? 'is-bad' : 'is-warn'}>
            {f.level === 'bad' ? <XCircle size={15} /> : <AlertTriangle size={15} />}
            <a href={f.href}>
              <span>{f.text}</span>
              {f.detail && <span className="ops-check-meta">{f.detail}</span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

const HOUR = 3_600_000

function attentionFlags(health: Part<HealthData>, uptime: Part<Uptime>, errors: Part<ErrorsData>, appErrors: Part<AppErrors>,
                               deploys: Part<DeploysData>, ai: Part<AiData>, pulse: Part<PulseData>, now = Date.now()): Flag[] {
  const out: Flag[] = []
  const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })

  // Down now: the live check first, the 5-minute history if the live one is not in yet.
  const down = new Set<string>()
  if (health.state === 'ok') {
    for (const c of health.data.checks.filter(c => !c.ok)) {
      down.add(c.name)
      out.push({ level: 'bad', text: `${c.name} is not answering`, detail: c.problem ?? (c.status ? `Answered ${c.status}` : undefined), href: '#status' })
    }
  }
  if (uptime.state === 'ok') {
    for (const t of uptime.data.targets.filter(t => t.down_now && !down.has(t.name))) {
      out.push({ level: 'bad', text: `${t.name} is down`, detail: 'Failing the 5-minute check', href: '#uptime' })
    }
    for (const i of uptime.data.incidents.filter(i => i.ended_at && now - new Date(i.started_at).getTime() < 24 * HOUR)) {
      out.push({ level: 'warn', text: `${i.target} was down ${i.minutes} min`,
                 detail: `${fmtWhen(i.started_at)} IST${i.problem ? ` · ${i.problem}` : ''} · back up now`, href: '#uptime' })
    }
  }

  // Cyra's errors carry a kind; running out of credit is the one that stops every engineer at once.
  if (errors.state === 'ok') {
    const credit = errors.data.groups.filter(g => g.kind === 'ai_credit' && now - new Date(g.last).getTime() < 6 * HOUR)
    if (credit.length) {
      const n = credit.reduce((a, g) => a + g.count, 0)
      out.push({ level: 'bad', text: 'Cyra Assist is out of OpenAI credit',
                 detail: `Engineers are getting errors · last ${ago(credit[0].last)} · ${fmtInt(n)} in this period. Top up in OpenAI billing.`, href: '#errors' })
    }
  }

  // Any other error still happening: seen in the last three hours, biggest first, three at most.
  const recent = [
    ...(appErrors.state === 'ok' ? appErrors.data.groups.map(g => ({ app: g.app, message: g.message, count: g.count, last: g.last })) : []),
    ...(errors.state === 'ok' ? errors.data.groups.filter(g => g.kind !== 'ai_credit').map(g => ({ app: 'cyra', message: g.message, count: g.count, last: g.last })) : []),
  ].filter(g => now - new Date(g.last).getTime() < 3 * HOUR).sort((a, b) => b.count - a.count).slice(0, 3)
  for (const g of recent) {
    out.push({ level: 'warn', text: `${MODULE_NAMES[g.app] ?? g.app}: ${g.message.length > 90 ? g.message.slice(0, 90) + '…' : g.message}`,
               detail: `Last ${ago(g.last)} · ${fmtInt(g.count)} in this period`, href: '#errors' })
  }

  // A day far above its own normal is worth a look even when no single message stands out.
  const today = istDay(now)
  const perDay = new Map<string, number>()
  for (const d of appErrors.state === 'ok' ? appErrors.data.by_day : []) perDay.set(d.day, (perDay.get(d.day) ?? 0) + d.errors)
  for (const d of errors.state === 'ok' ? errors.data.by_day : []) perDay.set(d.day, (perDay.get(d.day) ?? 0) + d.errors)
  const before = [...perDay].filter(([d]) => d < today).map(([, n]) => n)
  const avg = before.length ? before.reduce((a, n) => a + n, 0) / Math.max(before.length, 7) : 0
  const nToday = perDay.get(today) ?? 0
  if (nToday >= 20 && nToday > 3 * avg) {
    out.push({ level: 'warn', text: `${fmtInt(nToday)} errors today`, detail: `About ${fmtInt(Math.round(avg))} on a normal day`, href: '#errors' })
  }

  // The newest production deploy of a project failed: what people see is the build before it.
  if (deploys.state === 'ok') {
    const seen = new Set<string>()
    for (const d of deploys.data.deploys) {
      if (seen.has(d.project)) continue
      seen.add(d.project)
      if (d.state === 'ERROR') out.push({ level: 'bad', text: `Last deploy of ${d.project} failed`, detail: `${d.message || d.sha} · ${ago(d.at)}`, href: '#changes' })
    }
  }

  // AI spend running well above its own average.
  if (ai.state === 'ok') {
    const days = ai.data.by_day.filter(d => d.key < today)
    const avgCost = days.length ? days.reduce((a, d) => a + d.cost, 0) / days.length : 0
    const costToday = ai.data.by_day.find(d => d.key === today)?.cost ?? 0
    if (costToday >= 2 && costToday > 2 * avgCost) {
      out.push({ level: 'warn', text: `AI cost today ${fmtUsd(costToday)}`, detail: `Average ${fmtUsd(avgCost)} a day`, href: '#ai' })
    }
  }
  // Pulse can answer every check and still be showing directors yesterday's numbers.
  if (pulse.state === 'ok') {
    const late = pulse.data.sync.filter(j => j.late)
    if (late.length) {
      out.push({ level: 'bad', text: `Pulse SAP sync is late: ${late.map(j => j.job.replace(/^cyx/, '')).join(', ')}`,
                 detail: `Last success ${fmtAge(Math.max(...late.map(j => j.age_hours ?? Infinity)))} · directors see old figures`, href: '#pulse' })
    }
    const b = pulse.data.backups
    if (b.late) {
      out.push({ level: 'bad', text: 'Pulse backup missed', detail: b.newest ? `Newest is ${fmtAge(b.age_hours)}` : 'No backup file found', href: '#pulse' })
    }
    const d = pulse.data.disk
    if (d && d.free_pct !== null && d.free_pct < 15) {
      out.push({ level: d.free_pct < 5 ? 'bad' : 'warn', text: `Pulse server disk ${d.free_pct}% free`,
                 detail: `${fmtBytes(d.free_bytes)} left · backups need room every night`, href: '#pulse' })
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1))
}

function StatusPanel({ health, deploys }: { health: Part<HealthData>; deploys: Part<DeploysData> }) {
  const last = useMemo(() => {
    const m = new Map<string, Deploy>()
    if (deploys.state === 'ok') for (const d of deploys.data.deploys) if (!m.has(d.project) && d.state === 'READY') m.set(d.project, d)
    return m
  }, [deploys])
  const project: Record<string, string> = {
    portal: 'cyrix-platform', kpi: 'cyrix-kpi', spare: 'cyrix-spare-mapping', bemmp: 'cyrix-bemmp-dashboard',
    revive: 'cyrix-revive-lab', travel: 'cyrix-travel', tasks: 'cyrix-task', cyra: 'cyrix-cyra',
  }
  return (
    <Panel id="status" title="Status" note={health.state === 'ok' ? `Checked ${ago(health.data.at)}` : undefined}>
      <Waiting part={health} off="">
        {h => (
          <>
            <p className="ops-summary">
              {h.checks.every(c => c.ok)
                ? <><CheckCircle2 size={16} className="ok" /> All {h.checks.length} up</>
                : <><XCircle size={16} className="down" /> {h.checks.filter(c => !c.ok).length} of {h.checks.length} not answering</>}
            </p>
            <div className="ops-status">
              {h.checks.map(c => {
                const d = project[c.id] ? last.get(project[c.id]) : undefined
                return (
                  <div key={c.id} className={c.ok ? 'ops-check' : 'ops-check is-down'}>
                    <span className="ops-check-state">
                      {c.ok ? <CheckCircle2 size={15} className="ok" /> : <XCircle size={15} className="down" />}
                      <span className="sr">{c.ok ? 'Up' : 'Down'}</span>
                    </span>
                    <span className="ops-check-body">
                      <span className="ops-check-name">{c.name}</span>
                      <span className="ops-check-meta">
                        {c.ok ? `${c.status} · ${fmtInt(c.ms)} ms` : (c.problem ?? `Answered ${c.status}`)} · {c.group}
                      </span>
                      {d && <span className="ops-check-meta">Deployed {ago(d.at)}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Waiting>
    </Panel>
  )
}

/**
 * What happened between visits (KPI 0229): every app is checked every 5 minutes from the database, an outage opens
 * after two failed checks in a row, and the Ops admins get a push when one opens and when it closes.
 */
function UptimePanel({ uptime, days }: { uptime: Part<Uptime>; days: number }) {
  const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  return (
    <Panel id="uptime" title="Uptime" note="Checked every 5 minutes. An outage is two failed checks in a row, and the Ops admins get a push.">
      <Waiting part={uptime} off="Not set up yet: KPI migration 0229 has not been applied.">
        {u => (
          <>
            {u.first_check && new Date(u.first_check) > new Date(u.since) && (
              <p className="ops-note">Checking since {fmtWhen(u.first_check)} IST, so this covers less than {days} days.</p>
            )}
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead><tr><th>App</th><th className="num">Uptime</th><th className="num">Outages</th><th className="num">Checks</th></tr></thead>
                <tbody>
                  {u.targets.map(t => (
                    <tr key={t.id}>
                      <td>
                        {t.down_now ? <XCircle size={13} className="down" /> : <CheckCircle2 size={13} className="ok" />}{' '}
                        {t.name}<span className="ops-tag">{t.group}</span>
                      </td>
                      <td className="num">{t.uptime === null ? '—' : `${t.uptime}%`}</td>
                      <td className="num">{fmtInt(u.incidents.filter(i => i.target === t.name).length)}</td>
                      <td className="num">{fmtInt(t.checks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Outages, last {Math.min(days, 90)} days</h3>
            {u.incidents.length === 0 ? <p className="ops-note">None.</p> : (
              <ul className="ops-feed">
                {u.incidents.map((i, k) => (
                  <li key={k} className={i.ended_at ? undefined : 'is-down'}>
                    <XCircle size={14} className={i.ended_at ? undefined : 'down'} />
                    <span>
                      <span>{i.target} · {i.ended_at ? `down ${i.minutes} min` : `down for ${i.minutes} min, still down`}</span>
                      <span className="ops-check-meta">{fmtWhen(i.started_at)} IST{i.problem ? ` · ${i.problem}` : ''}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Waiting>
    </Panel>
  )
}

/**
 * Two sources, one panel: every app's browser errors from the shared database (KPI 0230), and Cyra Assist's own
 * app_error, which lives in Cyra's database and comes through /api/ops. Either can be missing without hiding the other.
 */
function ErrorsPanel({ errors, appErrors, days }: { errors: Part<ErrorsData>; appErrors: Part<AppErrors>; days: number }) {
  if (errors.state === 'loading' || appErrors.state === 'loading') {
    return <Panel id="errors" title="Errors"><div className="ops-skeleton" /></Panel>
  }
  const cyra = errors.state === 'ok' ? errors.data : null
  const apps = appErrors.state === 'ok' ? appErrors.data : null
  const problems = [
    appErrors.state === 'failed' && `Apps: ${appErrors.error}`,
    appErrors.state === 'off' && 'The other apps are not reporting yet: KPI migration 0230 is not applied.',
    errors.state === 'failed' && `Cyra Assist: ${errors.error}`,
    errors.state === 'off' && 'Cyra Assist is not connected: CYRA_SUPABASE_URL and CYRA_SERVICE_KEY are not on the portal.',
  ].filter(Boolean) as string[]

  const byDay = new Map<string, number>()
  for (const d of apps?.by_day ?? []) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.errors)
  for (const d of cyra?.by_day ?? []) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.errors)

  const byApp = [...(apps?.by_app ?? []).map(a => ({ ...a, people: a.people as number | null })),
                 ...(cyra && cyra.total > 0 ? [{ app: 'cyra', errors: cyra.total, messages: cyra.groups.length, people: null }] : [])]
    .sort((a, b) => b.errors - a.errors)

  const groups = [
    ...(apps?.groups ?? []).map(g => ({ app: g.app, message: g.message, where: g.route ?? '', tag: g.release ? `build ${g.release}` : '',
                                        count: g.count, people: g.people as number | null, last: g.last })),
    ...(cyra?.groups ?? []).map(g => ({ app: 'cyra', message: g.message,
                                        where: g.routes.join(', ') + (g.statuses.length ? ` · ${g.statuses.join(', ')}` : ''),
                                        tag: `${g.source} · ${g.kind}`, count: g.count, people: null, last: g.last })),
  ].sort((a, b) => b.count - a.count)

  const total = (apps?.total ?? 0) + (cyra?.total ?? 0)
  return (
    <Panel id="errors" title="Errors" note="What broke in front of somebody, grouped by message.">
      {problems.map(p => <p key={p} className="ops-off">{p}</p>)}
      {(apps || cyra) && (
        <>
          <Stats items={[{ label: `Errors, last ${days} days`, value: fmtInt(total) + (cyra?.truncated ? '+' : '') },
                         { label: 'Distinct messages', value: fmtInt(groups.length) },
                         { label: 'Apps with errors', value: fmtInt(byApp.length) }]} />
          <Bars label="Errors per day" data={fillDays(days, byDay)} fmt={fmtInt} />
          {byApp.length > 0 && (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <caption>By app</caption>
                <thead><tr><th>App</th><th className="num">Errors</th><th className="num">Messages</th><th className="num">People</th></tr></thead>
                <tbody>
                  {byApp.map(a => (
                    <tr key={a.app}>
                      <td>{MODULE_NAMES[a.app] ?? a.app}</td>
                      <td className="num">{fmtInt(a.errors)}</td>
                      <td className="num">{fmtInt(a.messages)}</td>
                      <td className="num">{a.people == null ? '—' : fmtInt(a.people)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {groups.length > 0 && (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <caption>Top messages</caption>
                <thead><tr><th>Message</th><th>Where</th><th className="num">Count</th><th className="num">People</th><th>Last</th></tr></thead>
                <tbody>
                  {groups.slice(0, 20).map((g, i) => (
                    <tr key={i}>
                      <td className="ops-msg">{g.message || <em>(no message)</em>}
                        <span className="ops-tag">{MODULE_NAMES[g.app] ?? g.app}{g.tag && ` · ${g.tag}`}</span></td>
                      <td className="ops-mono">{g.where || '—'}</td>
                      <td className="num">{fmtInt(g.count)}</td>
                      <td className="num">{g.people == null ? '—' : fmtInt(g.people)}</td>
                      <td>{ago(g.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total === 0 && <p className="ops-note">No errors in this window.</p>}
        </>
      )}
    </Panel>
  )
}

function UsagePanel({ overview, days }: { overview: Part<Overview>; days: number }) {
  return (
    <Panel id="usage" title="Usage" note="Sign-ins and actions recorded in each app's own trail. Pulse and Cyra are not in it yet.">
      <Waiting part={overview} off="">
        {o => (
          <>
            <Stats items={[
              { label: 'Accounts', value: fmtInt(o.accounts.total) },
              { label: 'Signed in today', value: fmtInt(o.accounts.signed_in_1d) },
              { label: 'Signed in, 7 days', value: fmtInt(o.accounts.signed_in_7d) },
              { label: 'Signed in, 30 days', value: fmtInt(o.accounts.signed_in_30d) },
              { label: 'Never signed in', value: fmtInt(o.accounts.never) },
            ]} />
            <Bars label="People signing in per day" data={fillDays(days, new Map(o.signins_by_day.map(d => [d.day, d.users])))} fmt={fmtInt} />
            <div className="ops-two">
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <caption>Activity by module, last {days} days</caption>
                  <thead><tr><th>Module</th><th className="num">People</th><th className="num">Actions</th></tr></thead>
                  <tbody>
                    {o.active_by_module.map(m => (
                      <tr key={m.module}><td>{MODULE_NAMES[m.module] ?? m.module}</td><td className="num">{fmtInt(m.users)}</td><td className="num">{fmtInt(m.events)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <caption>Who has each tile</caption>
                  <thead><tr><th>Tile</th><th className="num">People</th></tr></thead>
                  <tbody>
                    {o.grants.map(g => (
                      <tr key={g.code}><td>{g.name}{!g.active && <span className="ops-tag">off</span>}</td><td className="num">{fmtInt(g.users)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {o.top_actions.length > 0 && (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <caption>Most common actions, last 7 days</caption>
                  <thead><tr><th>Module</th><th>Action</th><th className="num">Times</th></tr></thead>
                  <tbody>
                    {o.top_actions.map((a, i) => (
                      <tr key={i}><td>{MODULE_NAMES[a.module] ?? a.module}</td><td className="ops-mono">{a.action}</td><td className="num">{fmtInt(a.events)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Waiting>
    </Panel>
  )
}

/** What only cyrix-svc01 can see about Pulse: the SAP sync, the nightly backup, the disk under both, the AI chat. */
function PulsePanel({ pulse }: { pulse: Part<PulseData> }) {
  return (
    <Panel id="pulse" title="Pulse" note="From the Pulse server itself: SAP sync, nightly backup, disk, AI chat.">
      <Waiting part={pulse} off="Not live yet: waiting for Pulse 1.12.0 to be deployed on cyrix-svc01.">
        {p => {
          const week = p.ai_chat.filter(d => d.day >= istDay(Date.now() - 6 * 86_400_000))
          return (
            <>
              <Stats items={[
                { label: 'SAP sync', value: p.sync.some(j => j.late) ? `${p.sync.filter(j => j.late).length} late` : 'On time' },
                { label: 'Last backup', value: fmtAge(p.backups.age_hours) },
                { label: 'Disk free', value: p.disk?.free_pct == null ? '—' : `${p.disk.free_pct}%` },
                { label: 'AI chat, 7 days', value: fmtInt(week.reduce((a, d) => a + d.questions, 0)) },
              ]} />
              {p.problems.map(x => <p key={x} className="ops-failed"><AlertTriangle size={15} /> Pulse could not read {x}</p>)}
              <div className="ops-two">
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <caption>SAP sync jobs</caption>
                    <thead><tr><th>Job</th><th>Runs</th><th>Last success</th></tr></thead>
                    <tbody>
                      {p.sync.map(j => (
                        <tr key={j.job}>
                          <td>{j.late ? <XCircle size={13} className="down" /> : <CheckCircle2 size={13} className="ok" />} {j.job.replace(/^cyx/, '')}</td>
                          <td>{j.every_hours === 1 ? 'Hourly' : 'Daily'}</td>
                          <td className={j.late ? 'down' : undefined}>{fmtAge(j.age_hours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <caption>Backups</caption>
                    <tbody>
                      <tr><td>Newest</td><td className={p.backups.late ? 'down' : undefined}>{p.backups.newest ? `${fmtAge(p.backups.age_hours)} · ${fmtBytes(p.backups.newest.size_bytes)}` : 'None found'}</td></tr>
                      <tr><td>Schedule</td><td>Nightly, {String(p.backups.scheduled_hour_ist).padStart(2, '0')}:00 IST</td></tr>
                      <tr><td>Kept</td><td>{fmtInt(p.backups.count)} files · {fmtBytes(p.backups.total_bytes)}</td></tr>
                      <tr><td>Disk</td><td>{p.disk ? `${fmtBytes(p.disk.free_bytes)} free of ${fmtBytes(p.disk.total_bytes)}` : '—'}</td></tr>
                      <tr><td>Failed, 30 days</td><td className={p.backup_failures.length ? 'down' : undefined}>{p.backup_failures.length || 'None'}</td></tr>
                    </tbody>
                  </table>
                  <p className="ops-note">Backups sit on the same server as the database, so a lost disk loses both.</p>
                </div>
              </div>
            </>
          )
        }}
      </Waiting>
    </Panel>
  )
}

function ChangesPanel({ changes, deploys }: { changes: Part<ChangesData>; deploys: Part<DeploysData> }) {
  const [repo, setRepo] = useState('')
  return (
    <Panel id="changes" title="Changes" note="Commits from GitHub and production deploys from Vercel.">
      <div className="ops-two">
        <div>
          <h3>Commits</h3>
          <Waiting part={changes} off="Not set up yet: GITHUB_TOKEN is not on the portal's Vercel project.">
            {c => (
              <>
                <div className="ops-chips">
                  <button aria-pressed={repo === ''} onClick={() => setRepo('')}>All</button>
                  {c.repos.filter(r => r.commits > 0 || r.failed).map(r => (
                    <button key={r.repo} aria-pressed={repo === r.repo} onClick={() => setRepo(r.repo)}
                      title={r.failed ? `GitHub answered ${r.failed}` : undefined}>
                      {r.repo} {r.failed ? '!' : r.commits}
                    </button>
                  ))}
                </div>
                <ul className="ops-feed">
                  {c.commits.filter(x => !repo || x.repo === repo).slice(0, 60).map(x => (
                    <li key={x.repo + x.sha}>
                      <GitCommitHorizontal size={14} />
                      <span>
                        <a href={x.url} target="_blank" rel="noreferrer">{x.message}</a>
                        <span className="ops-check-meta">{x.repo} · {x.author ?? 'unknown'} · {ago(x.at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Waiting>
        </div>
        <div>
          <h3>Deploys</h3>
          <Waiting part={deploys} off="Not set up yet: VERCEL_TOKEN is not on the portal's Vercel project.">
            {d => (
              <ul className="ops-feed">
                {d.deploys.slice(0, 40).map((x, i) => (
                  <li key={i} className={x.state === 'ERROR' ? 'is-down' : undefined}>
                    {x.state === 'ERROR' ? <XCircle size={14} className="down" /> : <Rocket size={14} />}
                    <span>
                      <span>{x.project}{x.state !== 'READY' && <span className="ops-tag">{x.state.toLowerCase()}</span>}</span>
                      <span className="ops-check-meta">{x.message || x.sha} · {ago(x.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Waiting>
        </div>
      </div>
    </Panel>
  )
}

function AiPanel({ ai, days }: { ai: Part<AiData>; days: number }) {
  return (
    <Panel id="ai" title="AI usage" note="Estimated from CYRA's own meter and its price table. Pulse and BEMMP are not metered yet.">
      <Waiting part={ai} off="Not set up yet: CYRA_SUPABASE_URL and CYRA_SERVICE_KEY are not on the portal's Vercel project.">
        {a => (
          <>
            <Stats items={[{ label: `Cost, last ${days} days`, value: fmtUsd(a.cost) },
                           { label: 'Calls', value: fmtInt(a.calls) },
                           { label: 'Per day, average', value: fmtUsd(a.cost / days) }]} />
            <Bars label="Cost per day (USD)" data={fillDays(days, new Map(a.by_day.map(d => [d.key, d.cost])))} fmt={fmtUsd} />
            <div className="ops-two">
              <SpendTable caption="By model" rows={a.by_model} />
              <SpendTable caption="By feature" rows={a.by_route} />
            </div>
          </>
        )}
      </Waiting>
    </Panel>
  )
}

function SpendTable({ caption, rows }: { caption: string; rows: Spend[] }) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <caption>{caption}</caption>
        <thead><tr><th>Name</th><th className="num">Calls</th><th className="num">Tokens</th><th className="num">Cost</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}><td className="ops-mono">{r.key}</td><td className="num">{fmtInt(r.calls)}</td><td className="num">{fmtInt(r.tokens)}</td><td className="num">{fmtUsd(r.cost)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---- pieces --------------------------------------------------------------------------------------------- */

function Stats({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="ops-stats">
      {items.map(s => <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}
    </dl>
  )
}

/**
 * One measure over days: thin bars from a zero baseline, one hue, no legend (the label names it). Hovering a
 * day — or focusing it from the keyboard — shows its value above the plot; the hit area is the full column.
 */
function Bars({ label, data, fmt }: { label: string; data: { day: string; value: number }[]; fmt: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map(d => d.value))
  const W = 100 / data.length
  const shown = hover ?? data.length - 1
  return (
    <figure className="ops-bars">
      <figcaption>
        <span>{label}</span>
        <span className="ops-bars-read">{shortDay(data[shown].day)}: <strong>{fmt(data[shown].value)}</strong></span>
      </figcaption>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${label}, peak ${fmt(max)}`}
           onMouseLeave={() => setHover(null)}>
        <line x1="0" x2="100" y1="40" y2="40" className="ops-axis" />
        {data.map((d, i) => {
          const h = (d.value / max) * 38
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={i * W} y="0" width={W} height="40" fill="transparent" />
              <rect x={i * W + W * 0.18} y={40 - h} width={W * 0.64} height={h}
                    className={hover === i ? 'ops-bar is-hover' : 'ops-bar'} rx="0.6" />
            </g>
          )
        })}
      </svg>
      <div className="ops-bars-x"><span>{shortDay(data[0].day)}</span><span>{shortDay(data[data.length - 1].day)}</span></div>
    </figure>
  )
}
