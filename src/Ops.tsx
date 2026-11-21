import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, GitCommitHorizontal, Rocket, BellRing, Download, Wrench,
} from 'lucide-react'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'
import { supabase } from './lib/supabase'
import { saveBlob, writeBook, type XlsxSheet } from './lib/xlsx'
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

/** Uptime per IST day (KPI 0302): each app's [checks, up], plus how many rounds ran and how many saw everything fail. */
interface UptimeDaily {
  since: string
  db_started: string | null
  targets: { id: string; name: string; group: string }[]
  days: { day: string; rounds: number; blind: number; apps: Record<string, [number, number]> }[]
}

/** People with an app open (KPI 0303): live counts, the last 24 h of 5-minute samples, and the typical day by IST hour. */
/** The maintenance switch (KPI 0303-0305): set here or in SW Admin → Platform; every app reads it. */
interface Maint { on?: boolean; from?: string | null; to?: string | null; apps?: string[]; notice_min?: number; by?: string; at?: string; now?: string }
const MAINT_APPS: [string, string][] = [
  ['portal', 'Portal'], ['kpi', 'KPI'], ['travel', 'Travel'], ['bemmp', 'BEMMP'], ['revive', 'Revive Lab'], ['tasks', 'My Task'],
  ['cyra', 'Cyra'], ['workplace', 'Workplace'], ['projects', 'Projects'], ['pulse', 'Pulse'],
]
const maintApps = (list?: string[]) => !list?.length ? 'every app' : MAINT_APPS.filter(([c]) => list.includes(c)).map(([, n]) => n).join(', ')
const maintWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })

interface ActiveNow {
  at: string; users_60: number; users_15: number; first_sample: string | null
  last_24h: [string, number][]
  by_hour: { hour: number; weekend: boolean; avg: number; peak: number }[]
}

/** Supabase's own status feed (/api/ops?part=upstream), last 14 days. `ours` = touches ap-south-1 or all regions. */
interface Upstream {
  checked: string
  region: string
  incidents: { title: string; status: string; updated: string; ours: boolean; open: boolean; scheduled: boolean
               components: string[]; detail: string; url: string }[]
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
/** One row of ops_latest() (KPI 0300): the newest stored check for each target. */
interface LatestRow { id: string; name: string; group: string; ok: boolean | null; status: number | null; ms: number | null; problem: string | null; at: string | null }
/** pg_cron jobs in the shared database and how they ran (ops_cron(), KPI 0300). */
interface CronJob { name: string; schedule: string; active: boolean; last_at: string | null; last_status: string | null
                    runs_24h: number; failed_24h: number; avg_s: number | null; last_error: string | null; last_error_at: string | null }
function toHealth(rows: LatestRow[]): HealthData {
  const at = rows.reduce((m, r) => (r.at && r.at > m ? r.at : m), '')
  return {
    at: at || new Date().toISOString(),
    checks: rows.map(r => ({ id: r.id, name: r.name, group: r.group, ok: r.ok === true, status: r.status, ms: r.ms ?? 0,
                             problem: r.at ? (r.problem ?? undefined) : 'Not checked yet' })),
  }
}
interface Deploy { project: string; state: string; at: string; message: string; sha: string; author: string | null }
interface Commit { repo: string; sha: string; at: string; message: string; author: string | null; url: string }
interface ErrGroup { source: string; kind: string; message: string; routes: string[]; count: number; last: string; statuses: number[] }
interface Spend { key: string; calls: number; cost: number; tokens: number }

type HealthData = { at: string; checks: Check[] }
type DeploysData = { deploys: Deploy[] }
type ChangesData = { repos: { repo: string; commits: number; failed: string | number | null }[]; commits: Commit[] }
type ErrorsData = { total: number; truncated: boolean; by_day: { day: string; errors: number }[]; groups: ErrGroup[] }
type SarvamUse = { calls: number; chars: number; inr: number }
type AiData = { cost: number; calls: number; unmetered: string[]; by_day: Spend[]; by_model: Spend[]; by_route: Spend[]
                sarvam?: { tts: SarvamUse; stt: SarvamUse } }

/** Pulse's own view of itself (Pulse 1.12.0, GET /pulse/api/ops/summary): what only cyrix-svc01 can see. */
interface PulseData {
  sync: { job: string; every_hours: number; age_hours: number | null; late: boolean }[]
  backups: { count: number; total_bytes: number; newest: { name: string; size_bytes: number } | null; age_hours: number | null; late: boolean; scheduled_hour_ist: number }
  disk: { total_bytes: number; free_bytes: number; free_pct: number | null } | null
  host?: { cpus: number | null; load: number[] | null; memory: { total_bytes: number; available_bytes: number | null } | null; booted_at: string | null }
  ai_chat: { day: string; questions: number; people: number }[]
  backup_failures: { at: string; by: string; file: string | null }[]
  problems: string[]
}

/** Pulse's and BEMMP's AI calls, metered in the shared database (KPI 0236). Cyra's come from its own meter (/api/ops). */
interface AiApps {
  cost: number; calls: number; unpriced: string[]
  by_day: { day: string; app: string; cost: number; calls: number }[]
  by_app: { key: string; cost: number; calls: number; tokens: number; people: number }[]
  by_model: { key: string; cost: number; calls: number; tokens: number; priced: boolean }[]
  by_feature: { key: string; cost: number; calls: number; tokens: number }[]
}

/** The 9 Oct audit's findings, measured (KPI 0237). */
interface SecurityData {
  testing_mode: unknown
  accounts: number; checked: number; default_pw: number; must_change: number; last_scan: string | null
  admins: { code: string; name: string; roles: string[]; default_pw: boolean | null }[]
  db_bytes: number
  storage: { bucket: string; files: number; bytes: number }[]
}

type Part<T> = { state: 'loading' } | { state: 'off' } | { state: 'failed'; error: string } | { state: 'ok'; data: T }

const MODULE_NAMES: Record<string, string> = {
  portal: 'Portal', cyra: 'Cyra Assist', pulse: 'Pulse', kpi: 'KPI', spare: 'Spare Mapping', bemmp: 'BEMMP', revive: 'Revive Lab', travel: 'Travel Expense', tasks: 'My Task',
  workplace: 'Workplace', projects: 'Projects',
}

/** Where things run and what the database says about itself (/api/ops?part=infra, KPI 0241 ops_db). */
interface InfraData {
  function_region: string | null
  db_ms: number | null
  supabase: { configured: boolean; region?: string | null; status?: string | null; version?: string | null; failed?: string
              requests_7d?: { rest: number; auth: number; storage: number; realtime: number } }
  analytics: { configured: boolean; apps?: { app: string; enabled: boolean; views?: number; visitors?: number | null; reason?: string }[] }
  compute?: {
    vercel: { plan?: string | null; projects?: number; memory?: string | null; timeout_s?: number | null; fluid?: boolean | null
              regions?: string[] | null; failed?: boolean } | null
    supabase: Partial<Record<'shared' | 'cyra', { region?: string | null; status?: string | null; size?: string | null; failed?: boolean }>>
    render: { name: string; type: string; suspended: boolean; plan: string | null; region: string | null; instances: number | null }[] | null
  }
}
interface DbData {
  version: string; started: string; size_bytes: number; max_connections: number
  connections: Record<string, number>; cache_hit_pct: number | null
  slow: { query: string; calls: number; mean_ms: number; total_s: number }[]
  tables: { name: string; bytes: number; rows: number }[]
}

/**
 * The app filter. Each source names an app its own way: a health or uptime id, a Vercel project, a GitHub repo, a
 * module key in the trails. One row per app says all of them, so the filter means the same thing in every panel.
 */
const APPS: { key: string; name: string; ids: string[]; project?: string; repo?: string }[] = [
  { key: 'portal', name: 'Portal', ids: ['portal'], project: 'cyrix-platform', repo: 'cyrix-platform' },
  { key: 'kpi', name: 'KPI', ids: ['kpi', 'db-shared'], project: 'cyrix-kpi', repo: 'Cyrix-KPI' },
  { key: 'spare', name: 'Spare Mapping', ids: ['spare'], project: 'cyrix-spare-mapping', repo: 'Cyrix-Spare-Mapping' },
  { key: 'bemmp', name: 'BEMMP', ids: ['bemmp'], project: 'cyrix-bemmp-dashboard', repo: 'Cyrix-Bemmp-Dashboard' },
  { key: 'revive', name: 'Revive Lab', ids: ['revive'], project: 'cyrix-revive-lab', repo: 'Cyrix-Revive-Lab' },
  { key: 'travel', name: 'Travel Expense', ids: ['travel'], project: 'cyrix-travel', repo: 'cyrix-travel' },
  { key: 'tasks', name: 'My Task', ids: ['tasks'], project: 'cyrix-task', repo: 'cyrix-task' },
  { key: 'workplace', name: 'Workplace', ids: ['workplace', 'inventory'], project: 'cyrix-workplace', repo: 'Cyrix-Workplace' },
  { key: 'projects', name: 'Projects', ids: ['projects'], project: 'cyrix-projects', repo: 'Cyrix-Projects' },
  { key: 'cyra', name: 'Cyra Assist', ids: ['cyra', 'cyra-engine', 'db-cyra'], project: 'cyrix-cyra', repo: 'Cyrix-Cyra' },
  { key: 'pulse', name: 'Pulse', ids: ['pulse'], repo: 'Cyrix-Pulse' },
]
const appOf = (key: string) => APPS.find(a => a.key === key)
const mapOk = <T,>(p: Part<T>, f: (d: T) => T): Part<T> => p.state === 'ok' ? { state: 'ok', data: f(p.data) } : p
const NO_ERRORS: ErrorsData = { total: 0, truncated: false, by_day: [], groups: [] }
const NO_AI: AiData = { cost: 0, calls: 0, unmetered: [], by_day: [], by_model: [], by_route: [] }
const NO_CRON: Part<CronJob[]> = { state: 'ok', data: [] }

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

/**
 * The round trip users feel: this browser to the shared database and back, median of three. Measured on the auth
 * health endpoint, which does no work, so the figure is the network and nothing else.
 */
async function browserToDb(): Promise<number | null> {
  const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  const ms: number[] = []
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    try {
      const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, cache: 'no-store' })
      if (r.ok) ms.push(performance.now() - t0)
    } catch { /* a miss */ }
  }
  ms.sort((a, b) => a - b)
  return ms.length ? Math.round(ms[Math.floor(ms.length / 2)]) : null
}

// AWS region codes as Supabase and Vercel name them. The shared database is in Mumbai since 21 Nov 2026 (Tokyo before).
const REGIONS: Record<string, string> = {
  'ap-northeast-1': 'Tokyo', 'ap-south-1': 'Mumbai', 'ap-southeast-1': 'Singapore', 'us-east-1': 'N. Virginia',
  'us-west-1': 'N. California', 'eu-west-1': 'Ireland', 'eu-central-1': 'Frankfurt',
  hnd1: 'Tokyo', bom1: 'Mumbai', sin1: 'Singapore', iad1: 'Washington DC', sfo1: 'San Francisco', fra1: 'Frankfurt', dub1: 'Dublin',
}
const regionName = (code: string | null | undefined) => code ? (REGIONS[code] ?? code) : '—'

// What the page costs to keep open (the user, 19 Nov: Vercel and Supabase both have monthly limits). The quick tier is
// Supabase RPCs only and never calls a Vercel function; the uptime round itself only runs every 5 minutes, so asking
// more often than every 2 minutes shows nothing new. The slow tier (deploys, commits, Cyra, Pulse, infra) is every 10.
const QUICK_MS = 2 * 60_000
const SLOW_MS = 10 * 60_000

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
// Rupees beside every dollar. The rate is app_settings.usd_inr, read with the slow tier, so changing it
// needs no deploy; until it arrives (or if the row is missing) the figure below stands.
let usdInr = 94.5
const fmtInr = (n: number) => {
  const r = n * usdInr
  return `₹${r < 10 ? r.toFixed(2) : Math.round(r).toLocaleString('en-IN')}`
}
const fmtUsd = (n: number) => `$${n.toFixed(2)} (${fmtInr(n)})`
const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 129600) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const SECTIONS = [['status', 'Status'], ['online', 'Online'], ['uptime', 'Uptime'], ['errors', 'Errors'], ['usage', 'Usage'], ['ai', 'AI cost'], ['pulse', 'Pulse'], ['security', 'Security'], ['cron', 'Scheduled jobs'], ['infra', 'Infrastructure'], ['changes', 'Changes']] as const
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
  const [daily, setDaily] = useState<Part<UptimeDaily>>({ state: 'loading' })
  const [online, setOnline] = useState<Part<ActiveNow>>({ state: 'loading' })
  const [maint, setMaint] = useState<Part<Maint>>({ state: 'loading' })
  const [upstream, setUpstream] = useState<Part<Upstream>>({ state: 'loading' })
  const [health, setHealth] = useState<Part<HealthData>>({ state: 'loading' })
  const [deploys, setDeploys] = useState<Part<DeploysData>>({ state: 'loading' })
  const [changes, setChanges] = useState<Part<ChangesData>>({ state: 'loading' })
  const [errors, setErrors] = useState<Part<ErrorsData>>({ state: 'loading' })
  const [appErrors, setAppErrors] = useState<Part<AppErrors>>({ state: 'loading' })
  const [ai, setAi] = useState<Part<AiData>>({ state: 'loading' })
  const [pulse, setPulse] = useState<Part<PulseData>>({ state: 'loading' })
  const [aiApps, setAiApps] = useState<Part<AiApps>>({ state: 'loading' })
  const [security, setSecurity] = useState<Part<SecurityData>>({ state: 'loading' })
  const [infra, setInfra] = useState<Part<InfraData>>({ state: 'loading' })
  const [db, setDb] = useState<Part<DbData>>({ state: 'loading' })
  const [cron, setCron] = useState<Part<CronJob[]>>({ state: 'loading' })
  const [browserMs, setBrowserMs] = useState<number | null>(null)
  const [app, setApp] = useState('all')
  const [exporting, setExporting] = useState(false)

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
      for (const fn of [setOverview, setUptime, setDaily, setOnline, setMaint, setUpstream, setHealth, setDeploys, setChanges, setErrors, setAppErrors, setAi, setPulse, setAiApps, setSecurity, setInfra, setDb, setCron] as
                       React.Dispatch<React.SetStateAction<Part<unknown>>>[]) fn({ state: 'loading' })
    }
    const jobs: PromiseLike<unknown>[] = [
      rpc(setAppErrors, 'ops_errors', { p_days: Math.min(d, 90) }),
      rpc(setUptime, 'ops_uptime', { p_days: Math.min(d, 90) }),
      // Who has an app open now: one count over recent sessions, cheap enough for the 2-minute tier (KPI 0303).
      rpc(setOnline, 'ops_active_now', {}),
      // The maintenance switch, so the page says when it is on (KPI 0303). One settings row.
      rpc(setMaint, 'platform_maintenance', {}),
      // The 5-minute round's own results, not a live ping of every app from a Vercel function (KPI 0300).
      supabase.rpc('ops_latest').then(
        r => keep(setHealth)(r.error ? { state: r.error.code === 'PGRST202' ? 'off' : 'failed', error: r.error.message } as Part<HealthData>
                                     : { state: 'ok', data: toHealth((r.data ?? []) as LatestRow[]) }),
        () => keep(setHealth)({ state: 'failed', error: 'Could not reach the database' })),
    ]
    if (slow) {
      jobs.push(
        api<ErrorsData>('errors', d).then(keep(setErrors)),
        rpc(setCron, 'ops_cron', {}),
        // Up to 90 days of checks per day: the slow tier, not every 2 minutes (KPI 0302).
        rpc(setDaily, 'ops_uptime_daily', { p_days: Math.min(d, 90) }),
        api<Upstream>('upstream', d).then(keep(setUpstream)),
        rpc(setOverview, 'ops_overview', { p_days: d }, false),
        api<DeploysData>('deploys', d).then(keep(setDeploys)),
        api<ChangesData>('changes', d).then(keep(setChanges)),
        api<AiData>('ai', d).then(keep(setAi)),
        pulseSummary().then(keep(setPulse)),
        rpc(setAiApps, 'ops_ai', { p_days: d }),
        rpc(setSecurity, 'ops_security', {}),
        api<InfraData>('infra', d).then(keep(setInfra)),
        rpc(setDb, 'ops_db', {}),
        browserToDb().then(ms => { if (ms !== null) setBrowserMs(ms) }),
        supabase.from('app_settings').select('value').eq('key', 'usd_inr').maybeSingle().then(r => {
          const v = Number(r.data?.value)
          if (v > 0) usdInr = v
        }),
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

  // Everything below reads the scoped copies, so the filter applies to every panel and to the Needs attention box.
  const sc = useMemo(() => {
    const a = appOf(app)
    if (!a) return { health, uptime, daily, appErrors, errors, overview, ai, aiApps, deploys, changes, pulse, security }
    const k = a.key
    return {
      health: mapOk(health, h => ({ ...h, checks: h.checks.filter(c => a.ids.includes(c.id)) })),
      uptime: mapOk(uptime, u => {
        const targets = u.targets.filter(t => a.ids.includes(t.id))
        const names = new Set(targets.map(t => t.name))
        return { ...u, targets, incidents: u.incidents.filter(i => names.has(i.target)) }
      }),
      daily: mapOk(daily, u => ({ ...u, targets: u.targets.filter(t => a.ids.includes(t.id)) })),
      appErrors: mapOk(appErrors, e => {
        const by_app = e.by_app.filter(x => x.app === k)
        return { ...e, by_app, groups: e.groups.filter(g => g.app === k), by_day: [], total: by_app.reduce((n, x) => n + x.errors, 0) }
      }),
      errors: k === 'cyra' ? errors : { state: 'ok', data: NO_ERRORS } as Part<ErrorsData>,
      overview: mapOk(overview, o => ({ ...o, signins_by_day: [], activity_by_day: o.activity_by_day.filter(x => x.module === k),
        active_by_module: o.active_by_module.filter(x => x.module === k), top_actions: o.top_actions.filter(x => x.module === k),
        grants: o.grants.filter(g => g.code === k) })),
      ai: k === 'cyra' ? ai : { state: 'ok', data: NO_AI } as Part<AiData>,
      aiApps: mapOk(aiApps, x => {
        const by_app = x.by_app.filter(r => r.key === k)
        return { ...x, by_app, by_day: x.by_day.filter(r => r.app === k), by_model: x.by_model.filter(r => r.key.startsWith(`${k} · `)),
                 by_feature: x.by_feature.filter(r => r.key.startsWith(`${k} · `)), unpriced: x.unpriced.filter(u => u.startsWith(k)),
                 cost: by_app.reduce((n, r) => n + r.cost, 0), calls: by_app.reduce((n, r) => n + r.calls, 0) }
      }),
      deploys: mapOk(deploys, d => ({ ...d, deploys: d.deploys.filter(x => x.project === a.project) })),
      changes: mapOk(changes, c => ({ ...c, repos: c.repos.filter(r => r.repo === a.repo), commits: c.commits.filter(x => x.repo === a.repo) })),
      pulse: k === 'pulse' ? pulse : { state: 'off' } as Part<PulseData>,
      security,
    }
  }, [app, health, uptime, daily, appErrors, errors, overview, ai, aiApps, deploys, changes, pulse, security])
  const scoped = app !== 'all'

  const exportReport = () => {
    setExporting(true)
    void buildReport({ days, app, ...sc, infra, db, browserMs })
      .then(blob => saveBlob(blob, `ops-report-${app}-${days}d-${istDay(Date.now())}.xlsx`))
      .finally(() => setExporting(false))
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
              <h1>Ops</h1>
              <p className="sub">Every Cyrix app: up or down, what broke, who used it, what shipped, and what the AI cost.</p>
            </div>
            <p className="ops-live" aria-live="polite">
              <span className="ops-live-dot" aria-hidden="true" />
              {updated ? `Updated ${clock(updated)}` : 'Loading'} · refreshes every 2 minutes while open
            </p>

            {/* Filter, period, export, refresh and the section links stay under the top bar while the page scrolls
                (the user, 21 Nov). On a phone the controls take one row and the links scroll sideways below them. */}
            <div className="ops-sticky">
              <div className="ops-controls">
                <select className="ops-select" aria-label="App" value={app} onChange={e => setApp(e.target.value)}>
                  <option value="all">All apps</option>
                  {APPS.map(a => <option key={a.key} value={a.key}>{a.name}</option>)}
                </select>
                <div className="ops-seg" role="group" aria-label="Period">
                  {([7, 30, 90] as Days[]).map(d => (
                    <button key={d} aria-pressed={days === d} onClick={() => setDays(d)} aria-label={`${d} days`}>{d}<span className="ops-long"> days</span><span className="ops-short" aria-hidden="true">d</span></button>
                  ))}
                </div>
                <button className="icon-btn" title="Download this view as an Excel report" onClick={exportReport} disabled={exporting}>
                  {exporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                </button>
                <button className="icon-btn" title="Check again now" onClick={refreshNow} disabled={busy}>
                  <RefreshCw size={16} className={busy ? 'spin' : undefined} />
                </button>
              </div>
              <nav className="ops-jump" aria-label="Sections">
                {SECTIONS.map(([id, name]) => <a key={id} href={`#${id}`}>{name}</a>)}
              </nav>
            </div>

            {scoped && (
              <p className="ops-note">Showing {appOf(app)?.name} only. Charts that the sources cannot split by app are hidden; Security and Infrastructure stay company-wide.</p>
            )}
            <Attention health={sc.health} uptime={sc.uptime} errors={sc.errors} appErrors={sc.appErrors} deploys={sc.deploys} ai={sc.ai} pulse={sc.pulse} security={sc.security} cron={scoped ? NO_CRON : cron}
                       upstream={upstream} db={db} maint={maint} />
            <StatusPanel health={sc.health} deploys={sc.deploys} />
            {!scoped && <OnlinePanel online={online} maint={maint} onMaintChanged={() => { void supabase.rpc('platform_maintenance').then(r => { if (!r.error) setMaint({ state: 'ok', data: r.data as Maint }) }) }} />}
            {/* The timeline needs the width: a column per day. */}
            <UptimePanel uptime={sc.uptime} daily={sc.daily} upstream={upstream} days={days} />
            <ErrorsPanel errors={sc.errors} appErrors={sc.appErrors} deploys={sc.deploys} days={days} scoped={scoped} />
            <div className="ops-pair">
              <UsagePanel overview={sc.overview} days={days} scoped={scoped} />
              <AiPanel ai={sc.ai} aiApps={sc.aiApps} days={days} />
            </div>
            {(!scoped || app === 'pulse') ? (
              <div className="ops-pair">
                <PulsePanel pulse={sc.pulse} />
                <SecurityPanel security={sc.security} />
              </div>
            ) : <SecurityPanel security={sc.security} />}
            <CronPanel cron={cron} />
            <InfraPanel infra={infra} db={db} pulse={pulse} browserMs={browserMs} />
            <ChangesPanel changes={sc.changes} deploys={sc.deploys} />
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

function Attention({ health, uptime, errors, appErrors, deploys, ai, pulse, security, cron, upstream, db, maint }: {
  cron: Part<CronJob[]>; upstream: Part<Upstream>; db: Part<DbData>; maint: Part<Maint>
  health: Part<HealthData>; uptime: Part<Uptime>; errors: Part<ErrorsData>; appErrors: Part<AppErrors>
  deploys: Part<DeploysData>; ai: Part<AiData>; pulse: Part<PulseData>; security: Part<SecurityData>
}) {
  const flags = useMemo(() => [...maintFlags(maint), ...upstreamFlags(upstream, db), ...attentionFlags(health, uptime, errors, appErrors, deploys, ai, pulse, security, cron)]
                          .sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1)),
                        [health, uptime, errors, appErrors, deploys, ai, pulse, security, cron, upstream, db, maint])
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

/** Maintenance on, or planned: said at the top so nobody reads a quiet page as a healthy one. */
function maintFlags(maint: Part<Maint>): Flag[] {
  if (maint.state !== 'ok' || !maint.data.on) return []
  const m = maint.data
  const now = m.now ? Date.parse(m.now) : Date.now()
  const back = m.to ? ` · back by ${maintWhen(m.to)}` : ''
  if (m.from && Date.parse(m.from) > now) {
    return [{ level: 'warn', text: `Maintenance planned from ${maintWhen(m.from)} for ${maintApps(m.apps)}`, detail: `Set by ${m.by ?? '—'}${back}`, href: '#online' }]
  }
  return [{ level: 'bad', text: `Maintenance is on for ${maintApps(m.apps)}`, detail: `People see the maintenance screen; admins get through. Set by ${m.by ?? '—'}${back}`, href: '#online' }]
}

/**
 * The database under everything, and Supabase above it. 20 Nov 2026: all 60 connection slots filled at 09:40 IST,
 * Postgres stopped answering at 09:52 and crash-restarted at 10:06. None of that was on the page except as thirteen
 * apps failing at once, and Supabase's own feed was quiet, so the cause was ours. These say so directly.
 */
function upstreamFlags(upstream: Part<Upstream>, db: Part<DbData>, now = Date.now()): Flag[] {
  const out: Flag[] = []
  if (upstream.state === 'ok') {
    for (const i of upstream.data.incidents.filter(i => i.open)) {
      out.push({ level: i.ours ? 'bad' : 'warn', text: `Supabase: ${i.title}`,
                 detail: `${i.status}${i.ours ? ` · affects ${upstream.data.region}, our region` : ' · not our region'} · ${ago(i.updated)}`, href: '#uptime' })
    }
  }
  if (db.state === 'ok') {
    const d = db.data
    const used = Object.values(d.connections).reduce((n, x) => n + x, 0)
    if (d.max_connections > 0 && used / d.max_connections >= 0.8) {
      out.push({ level: used / d.max_connections >= 0.9 ? 'bad' : 'warn', text: `Database connections ${used} of ${d.max_connections}`,
                 detail: 'When they run out every app fails at once (20 Nov). Larger compute raises the limit.', href: '#infra' })
    }
    if (d.started && now - Date.parse(d.started) < 24 * HOUR) {
      out.push({ level: 'warn', text: `Database restarted ${ago(d.started)}`,
                 detail: 'If nobody restarted it, it fell over. Check Infrastructure and the Supabase logs.', href: '#infra' })
    }
  }
  return out
}

function attentionFlags(health: Part<HealthData>, uptime: Part<Uptime>, errors: Part<ErrorsData>, appErrors: Part<AppErrors>,
                               deploys: Part<DeploysData>, ai: Part<AiData>, pulse: Part<PulseData>, security: Part<SecurityData>,
                               cron: Part<CronJob[]> = { state: 'loading' }, now = Date.now()): Flag[] {
  const out: Flag[] = []
  // A scheduled job that keeps failing (KPI 0300). Three in a day, or its latest run failed.
  if (cron.state === 'ok') {
    for (const j of cron.data.filter(j => j.active && (j.failed_24h >= 3 || j.last_status === 'failed'))) {
      out.push({ level: 'warn', text: `Scheduled job ${j.name} is failing`,
                 detail: `${j.failed_24h} of ${j.runs_24h} runs failed in 24 h${j.last_error ? ` · ${j.last_error}` : ''}`, href: '#cron' })
    }
  }
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
  // The 9 Oct audit's two critical findings, until they are fixed.
  if (security.state === 'ok') {
    const sec = security.data
    if (sec.testing_mode === true || sec.testing_mode === 'true') {
      out.push({ level: 'bad', text: 'testing_mode is on in production', detail: 'Lets SW Admin wipe one employee\'s KPI history outright. Turn it off once nobody needs that.', href: '#security' })
    }
    const admins = sec.admins.filter(a => a.default_pw)
    if (admins.length) {
      out.push({ level: 'bad', text: `${admins.length} admin account${admins.length > 1 ? 's' : ''} still on the default password`,
                 detail: admins.map(a => `${a.code} (${a.roles.join(', ')})`).join(' · '), href: '#security' })
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1))
}

/**
 * Who is on the platform. Two uses: knowing how many people an outage is hitting, and picking a maintenance window
 * (Adrian, 20 Nov 2026: backend work must not land on people mid-task). "Online" = a signed-in session that refreshed
 * in the last hour, which an open tab of any Cyrix app does about hourly. People, not tabs; no names.
 */
function OnlinePanel({ online, maint, onMaintChanged }: { online: Part<ActiveNow>; maint: Part<Maint>; onMaintChanged: () => void }) {
  return (
    <Panel id="online" title="People online" note="Signed in with a Cyrix app open (session refreshed in the last hour). Counted every 5 minutes.">
      {maint.state === 'ok' && <MaintenanceBox m={maint.data} onlineNow={online.state === 'ok' ? online.data.users_15 : null} onChanged={onMaintChanged} />}
      <Waiting part={online} off="Needs KPI migration 0303 (ops/apply-0303.sql).">
        {o => {
          const weekday = o.by_hour.filter(h => !h.weekend)
          const weekend = o.by_hour.filter(h => h.weekend)
          const quiet = (rows: typeof weekday) => {
            // The three-hour block with the lowest average, among hours with samples.
            const by = new Map(rows.map(r => [r.hour, r.avg]))
            if (by.size < 12) return null
            let best: { start: number; avg: number } | null = null
            for (let h = 0; h < 24; h++) {
              const v = [0, 1, 2].map(k => by.get((h + k) % 24))
              if (v.some(x => x === undefined)) continue
              const a = (v as number[]).reduce((n, x) => n + x, 0) / 3
              if (!best || a < best.avg) best = { start: h, avg: a }
            }
            return best
          }
          const fmtH = (h: number) => String(h % 24).padStart(2, '0')
          const qd = quiet(weekday), qe = quiet(weekend)
          return (
            <>
              <Stats items={[
                { label: 'Online now', value: fmtInt(o.users_60) },
                { label: 'Active in last 15 min', value: fmtInt(o.users_15) },
                { label: 'Quietest weekday (IST)', value: qd ? `${fmtH(qd.start)}:00–${fmtH(qd.start + 3)}:00` : '—' },
                { label: 'Quietest weekend (IST)', value: qe ? `${fmtH(qe.start)}:00–${fmtH(qe.start + 3)}:00` : '—' },
              ]} />
              {o.last_24h.length > 1 && <OnlineLine points={o.last_24h} />}
              {weekday.length > 0 && <HourBars weekday={weekday} weekend={weekend} />}
              {(!qd || !qe) && (
                <p className="ops-note">Counting since {o.first_sample ? new Date(o.first_sample).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : 'now'}. The quiet hours show once a full weekday and weekend have been counted.</p>
              )}
            </>
          )
        }}
      </Waiting>
    </Panel>
  )
}

/** The last 24 hours as a thin line, with the figure at the point under the pointer. */
function OnlineLine({ points }: { points: [string, number][] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...points.map(p => p[1]))
  const t0 = Date.parse(points[0][0]), t1 = Date.parse(points[points.length - 1][0])
  const x = (t: string) => ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * 100
  const y = (v: number) => 38 - (v / max) * 34
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join(' ')
  const shown = points[hover ?? points.length - 1]
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  return (
    <figure className="ops-bars">
      <figcaption><span>Last 24 hours</span><span className="ops-bars-read">{time(shown[0])}: <strong>{fmtInt(shown[1])} online</strong></span></figcaption>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`People online over the last 24 hours, peak ${max}`}
           onMouseLeave={() => setHover(null)}
           onMouseMove={e => {
             const r = e.currentTarget.getBoundingClientRect()
             const f = (e.clientX - r.left) / r.width
             const t = t0 + f * (t1 - t0)
             let best = 0
             for (let i = 1; i < points.length; i++) if (Math.abs(Date.parse(points[i][0]) - t) < Math.abs(Date.parse(points[best][0]) - t)) best = i
             setHover(best)
           }}>
        <path d={`${d} L100,40 L0,40 Z`} className="ops-line-fill" />
        <path d={d} className="ops-line" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={x(shown[0])} x2={x(shown[0])} y1="0" y2="40" className="ops-line-cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="ops-bars-x"><span>{time(points[0][0])}</span><span>now</span></div>
    </figure>
  )
}

/** A typical day: average people online per IST hour, weekdays and weekends side by side. The low bars are the window. */
/**
 * The maintenance switch, beside the numbers it should be set from (KPI 0303-0305). The same switch as SW Admin →
 * Platform; the Ops admins may set it too (0305). Asks before changing, and says how many people will be cut off
 * when it is turned on with no From (no notice bar for them).
 */
function MaintenanceBox({ m, onlineNow, onChanged }: { m: Maint; onlineNow: number | null; onChanged: () => void }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [notice, setNotice] = useState(60)
  const [apps, setApps] = useState<string[]>([])
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = m.now ? Date.parse(m.now) : Date.now()
  const planned = !!m.on && !!m.from && Date.parse(m.from) > now

  const save = async (next: boolean) => {
    setBusy(true); setError(null)
    if (next && from && to && new Date(to) <= new Date(from)) { setError('To must be after From.'); setBusy(false); return }
    const { error: e } = await supabase.rpc('platform_set_maintenance', {
      p_on: next,
      p_from: next && from ? new Date(from).toISOString() : null,
      p_to: next && to ? new Date(to).toISOString() : null,
      p_apps: next ? apps : [],
      p_notice_min: next ? notice : 15,
    })
    setBusy(false)
    if (e) { setError(e.message); return }
    setAsking(false)
    if (!next) { setFrom(''); setTo(''); setApps([]) }
    onChanged()
  }

  const confirm = (
    <div className="ops-maint-ask">
      <p>{m.on ? `Turn maintenance off for ${maintApps(m.apps)}?`
               : `Turn maintenance on for ${maintApps(apps)}${from ? ` from ${maintWhen(new Date(from).toISOString())}` : ' now'}?`}</p>
      {!m.on && !from && (onlineNow ?? 0) > 0 && (
        <p className="ops-check-meta">{onlineNow} people were active in the last 15 minutes and will see the screen straight away, with no notice bar. A From gives them warning.</p>
      )}
      <div className="ops-maint-row">
        <button className="ops-maint-go" disabled={busy} onClick={() => { void save(!m.on) }}>{busy ? 'Saving…' : m.on ? 'Yes, turn off' : 'Yes, turn on'}</button>
        <button className="ops-maint-cancel" disabled={busy} onClick={() => { setAsking(false); setError(null) }}>Cancel</button>
      </div>
    </div>
  )

  if (m.on) {
    return (
      <div className={planned ? 'ops-maint is-planned' : 'ops-maint is-on'}>
        <div className="ops-maint-row">
          <Wrench size={15} />
          <strong>{planned ? `Maintenance planned from ${maintWhen(m.from!)}` : 'Maintenance is on'}</strong>
          <span className="ops-check-meta">{maintApps(m.apps)}{m.to ? ` · back by ${maintWhen(m.to)}` : ''}{m.by ? ` · set by ${m.by}` : ''}</span>
          {!asking && <button className="ops-maint-go" onClick={() => setAsking(true)}>Turn off</button>}
        </div>
        {asking && confirm}
        {error && <p className="ops-maint-err">{error}</p>}
      </div>
    )
  }
  return (
    <details className="ops-maint">
      <summary><Wrench size={15} /> Maintenance mode <span className="ops-check-meta">off · plan a window from the quiet hours below</span></summary>
      <div className="ops-maint-form">
        <label>From<input type="datetime-local" className="ops-select" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To<input type="datetime-local" className="ops-select" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
        <label>Notice bar before
          <select className="ops-select" value={notice} onChange={e => setNotice(Number(e.target.value))}>
            {[[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [180, '3 hours'], [1440, '1 day']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <div className="ops-chips" role="group" aria-label="Apps">
        <button aria-pressed={!apps.length} onClick={() => setApps([])}>All</button>
        {MAINT_APPS.map(([c, n]) => (
          <button key={c} aria-pressed={apps.includes(c)} onClick={() => setApps(a => a.includes(c) ? a.filter(x => x !== c) : [...a, c])}>{n}</button>
        ))}
      </div>
      {asking ? confirm : <button className="ops-maint-go" onClick={() => { setAsking(true); setError(null) }}>{from ? 'Plan it' : 'Turn on now'}</button>}
      {error && <p className="ops-maint-err">{error}</p>}
      <p className="ops-note">Leave From empty to start now. It stays on until turned off here or in SW Admin → Platform. SW Admin, Adrian and Kevin still get in, with a red bar.</p>
    </details>
  )
}

function HourBars({ weekday, weekend }: { weekday: ActiveNow['by_hour']; weekend: ActiveNow['by_hour'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const wd = new Map(weekday.map(r => [r.hour, r])), we = new Map(weekend.map(r => [r.hour, r]))
  const max = Math.max(1, ...weekday.map(r => r.avg), ...weekend.map(r => r.avg))
  const hh = hover ?? Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }))
  return (
    <figure className="ops-bars">
      <figcaption>
        <span>Typical day, average online by hour (IST, last 14 days)</span>
        <span className="ops-bars-read">{String(hh).padStart(2, '0')}:00 · weekday <strong>{wd.get(hh)?.avg ?? '—'}</strong>
          {' '}· weekend <strong>{we.get(hh)?.avg ?? '—'}</strong></span>
      </figcaption>
      <svg viewBox="0 0 240 40" preserveAspectRatio="none" role="img" aria-label="Average people online per hour of day" onMouseLeave={() => setHover(null)}>
        <line x1="0" x2="240" y1="40" y2="40" className="ops-axis" />
        {Array.from({ length: 24 }, (_, i) => {
          const a = wd.get(i)?.avg ?? 0, b = we.get(i)?.avg ?? 0
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * 10} y="0" width="10" height="40" fill="transparent" />
              <rect x={i * 10 + 1.5} y={40 - (a / max) * 38} width="3.2" height={(a / max) * 38} rx="1" className={hover === i ? 'ops-bar is-hover' : 'ops-bar'} />
              <rect x={i * 10 + 5.3} y={40 - (b / max) * 38} width="3.2" height={(b / max) * 38} rx="1" className="ops-bar-alt" />
            </g>
          )
        })}
      </svg>
      <div className="ops-bars-x"><span>00:00</span><span className="ops-bars-key"><i className="ops-key-a" /> weekday <i className="ops-key-b" /> weekend</span><span>23:00</span></div>
    </figure>
  )
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
    inventory: 'cyrix-workplace', workplace: 'cyrix-workplace', projects: 'cyrix-projects',
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
                        {c.ok ? `Answered ${c.status}` : (c.problem ?? `Answered ${c.status}`)} · {c.group}
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
function UptimePanel({ uptime, daily, upstream, days }: { uptime: Part<Uptime>; daily: Part<UptimeDaily>; upstream: Part<Upstream>; days: number }) {
  const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  return (
    <Panel id="uptime" title="Uptime" note="Checked every 5 minutes. An outage is two failed checks in a row, and the Ops admins get a push.">
      <UpstreamBox upstream={upstream} />
      {daily.state === 'ok' && daily.data.days.length > 0 && <UptimeTimeline daily={daily.data} days={Math.min(days, 90)} />}
      {daily.state === 'failed' && <p className="ops-off">Timeline: {daily.error}</p>}
      {daily.state === 'off' && <p className="ops-off">The timeline needs KPI migration 0302.</p>}
      <Waiting part={uptime} off="Not set up yet: KPI migration 0229 has not been applied.">
        {u => (
          <>
            {u.first_check && new Date(u.first_check) > new Date(u.since) && (
              <p className="ops-note">Checking since {fmtWhen(u.first_check)} IST, so this covers less than {days} days.</p>
            )}
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

/** Rounds a full day should hold: one every 5 minutes. Today, only the part that has happened. */
const ROUNDS_PER_DAY = 288
function expectedRounds(day: string, first: boolean, rounds: number, now = Date.now()): number {
  if (first) return rounds                         // monitoring started part way through that day
  if (day !== istDay(now)) return ROUNDS_PER_DAY
  const mid = Date.parse(`${day}T00:00:00+05:30`)
  return Math.max(rounds, Math.floor((now - mid) / 300_000))
}

/**
 * Uptime over time, status-page style: a slim bar per day for each app, coloured by that day's uptime. Rounds the monitor could not run
 * count as down: it runs inside the shared database, so when it cannot run, nothing that uses that database can
 * either. Below it, availability per calendar month, the figure a contract or an SLA is written against.
 */
function UptimeTimeline({ daily, days }: { daily: UptimeDaily; days: number }) {
  const [hover, setHover] = useState<{ app: string; day: string } | null>(null)
  const cols = useMemo(() => {
    const out: string[] = []
    const end = Date.now()
    for (let i = days - 1; i >= 0; i--) out.push(istDay(end - i * 86_400_000))
    return out
  }, [days])
  const byDay = useMemo(() => new Map(daily.days.map(d => [d.day, d])), [daily])
  const firstDay = daily.days[0]?.day

  // One cell's figures: up / (checks + rounds missed). null = no data that day.
  const cell = (id: string | null, day: string) => {
    const d = byDay.get(day)
    if (!d) return null
    const exp = expectedRounds(day, day === firstDay, d.rounds)
    const missed = Math.max(0, exp - d.rounds)
    const ids = id ? [id] : daily.targets.map(t => t.id)
    let n = 0, up = 0, per = 0
    for (const t of ids) {
      const v = d.apps[t]
      if (!v) continue
      n += v[0]; up += v[1]
      // A target added part way through the day was not missed before it existed.
      if (v[0] >= d.rounds - 1) per += 1
    }
    if (n === 0) return null
    const pct = (100 * up) / (n + missed * per)
    const apps = Math.max(1, ids.filter(t => d.apps[t]).length)
    return { pct, down: Math.round(((n + missed * per - up) / apps) * 5), missed: per > 0 ? missed : 0, blind: d.blind }
  }
  const tone = (pct: number | undefined) => pct === undefined ? 'is-none' : pct >= 99.9 ? 'is-good' : pct >= 98 ? 'is-warn' : 'is-bad'

  const months = useMemo(() => {
    const keys = [...new Set(daily.days.map(d => d.day.slice(0, 7)))]
    return keys.map(m => {
      const per = new Map<string, [number, number]>()
      for (const d of daily.days.filter(x => x.day.startsWith(m))) {
        const exp = expectedRounds(d.day, d.day === firstDay, d.rounds)
        const missed = Math.max(0, exp - d.rounds)
        for (const t of daily.targets) {
          const v = d.apps[t.id]; if (!v) continue
          const cur = per.get(t.id) ?? [0, 0]
          per.set(t.id, [cur[0] + v[0] + (v[0] >= d.rounds - 1 ? missed : 0), cur[1] + v[1]])
        }
      }
      return { month: m, per }
    })
  }, [daily, firstDay])
  const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  const fmtPct = (n: number) => n >= 99.995 ? '100%' : `${n.toFixed(2)}%`

  // Each row's figure for the whole period: the same rule as a cell, summed over the days.
  const total = (id: string | null) => {
    let n = 0, up = 0
    for (const d of daily.days) {
      const exp = expectedRounds(d.day, d.day === firstDay, d.rounds)
      const missed = Math.max(0, exp - d.rounds)
      const ids = id ? [id] : daily.targets.map(t => t.id)
      for (const t of ids) {
        const v = d.apps[t]
        if (!v) continue
        n += v[0] + (v[0] >= d.rounds - 1 ? missed : 0); up += v[1]
      }
    }
    return n > 0 ? (100 * up) / n : null
  }
  const overall = total(null)
  const label = (r: { id: string | null; name: string }, day: string) => {
    const c = cell(r.id, day)
    if (!c) return `${shortDay(day)} · no checks`
    return `${shortDay(day)} · ${fmtPct(c.pct)}${c.down > 0 ? ` · ~${c.down} min down` : ''}${c.missed > 0 ? ` · monitor missed ${c.missed} round${c.missed > 1 ? 's' : ''}` : ''}`
  }

  const strip = (r: { id: string | null; name: string }, big = false) => (
    <div className={big ? 'ops-tl-strip is-big' : 'ops-tl-strip'} style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
         onMouseLeave={() => setHover(null)}>
      {cols.map(day => {
        const c = cell(r.id, day)
        const on = hover?.app === (r.id ?? 'all') && hover.day === day
        return (
          <span key={day} className={`ops-tl-bar ${tone(c?.pct)}${on ? ' is-on' : ''}`} aria-label={label(r, day)}
                onMouseEnter={() => setHover({ app: r.id ?? 'all', day })}>
            {on && <span className="ops-tl-tip" role="tooltip">{label(r, day)}</span>}
          </span>
        )
      })}
    </div>
  )
  const axis = (
    <div className="ops-tl-axis" aria-hidden="true">
      <span>{days} days ago</span><span className="ops-tl-axis-line" /><span>Today</span>
    </div>
  )

  return (
    <>
      <div className="ops-tl-hero">
        <div>
          <span className={overall !== null && overall < 99 ? 'ops-tl-big down' : 'ops-tl-big'}>{overall === null ? '—' : fmtPct(overall)}</span>
          <span className="ops-tl-sub">all apps, last {days} days</span>
        </div>
        <span className="ops-tl-key" aria-hidden="true">
          <i className="ops-tl-dot is-good" />Up <i className="ops-tl-dot is-warn" />Partial <i className="ops-tl-dot is-bad" />Outage <i className="ops-tl-dot is-none" />No data
        </span>
      </div>
      {strip({ id: null, name: 'All apps' }, true)}
      {axis}
      <ul className="ops-tl-list">
        {daily.targets.map(t => {
          const pct = total(t.id)
          return (
            <li key={t.id}>
              <div className="ops-tl-head">
                <span className="ops-tl-name">{t.name}<span className="ops-tag">{t.group}</span></span>
                <span className={pct !== null && pct < 99 ? 'ops-tl-pct down' : 'ops-tl-pct'}>{pct === null ? '—' : fmtPct(pct)}</span>
              </div>
              {strip(t)}
            </li>
          )
        })}
      </ul>
      <details className="ops-tl-months">
        <summary>Availability per month</summary>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <caption>Rounds the monitor missed count as down</caption>
          <thead><tr><th>App</th>{months.map(m => <th key={m.month} className="num">{monthName(m.month)}</th>)}</tr></thead>
          <tbody>
            {daily.targets.map(t => (
              <tr key={t.id}>
                <td>{t.name}<span className="ops-tag">{t.group}</span></td>
                {months.map(m => {
                  const v = m.per.get(t.id)
                  const pct = v && v[0] > 0 ? (100 * v[1]) / v[0] : null
                  return <td key={m.month} className={pct !== null && pct < 99 ? 'num down' : 'num'}>{pct === null ? '—' : fmtPct(pct)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </details>
    </>
  )
}

/** Supabase's own status, so "is it them or us" has an answer on the page. */
function UpstreamBox({ upstream }: { upstream: Part<Upstream> }) {
  if (upstream.state === 'loading') return null
  if (upstream.state !== 'ok') return <p className="ops-off">Supabase status: {upstream.state === 'failed' ? upstream.error : 'not available'}</p>
  const u = upstream.data
  const open = u.incidents.filter(i => i.open)
  const ours = u.incidents.filter(i => i.ours && !i.scheduled)
  return (
    <div className={open.some(i => i.ours) ? 'ops-upstream is-bad' : open.length ? 'ops-upstream is-warn' : 'ops-upstream'}>
      <p className="ops-summary">
        {open.length === 0
          ? <><CheckCircle2 size={15} className="ok" /> Supabase reports no open incident</>
          : <><AlertTriangle size={15} className={open.some(i => i.ours) ? 'down' : undefined} /> Supabase: {open.length} open incident{open.length > 1 ? 's' : ''}{open.some(i => i.ours) ? `, ${u.region} affected` : ', not our region'}</>}
        <span className="ops-check-meta"> · {ours.length === 0 ? `nothing in ${u.region} in 14 days` : `${ours.length} in ${u.region} in 14 days`} · <a href="https://status.supabase.com/" target="_blank" rel="noreferrer">status.supabase.com</a></span>
      </p>
      {[...open, ...ours.filter(i => !i.open)].slice(0, 4).map((i, k) => (
        <p key={k} className="ops-check-meta">
          <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a> · {i.status} · {ago(i.updated)}
        </p>
      ))}
    </div>
  )
}

/**
 * Two sources, one panel: every app's browser errors from the shared database (KPI 0230), and Cyra Assist's own
 * app_error, which lives in Cyra's database and comes through /api/ops. Either can be missing without hiding the other.
 */
function ErrorsPanel({ errors, appErrors, deploys, days, scoped = false }: { errors: Part<ErrorsData>; appErrors: Part<AppErrors>; deploys: Part<DeploysData>; days: number; scoped?: boolean }) {
  // Days with a production deploy, marked on the chart so a spike that starts right after one is plain to see.
  const deployDays = useMemo(() => {
    const m = new Map<string, number>()
    if (deploys.state === 'ok') for (const d of deploys.data.deploys) if (d.state === 'READY') {
      const k = istDay(Date.parse(d.at)); m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [deploys])
  if (errors.state === 'loading' || appErrors.state === 'loading') {
    return <Panel id="errors" title="Errors"><div className="ops-skeleton" /></Panel>
  }
  const cyra = errors.state === 'ok' ? errors.data : null
  const apps = appErrors.state === 'ok' ? appErrors.data : null
  const showDays = !scoped || (cyra !== null && (apps?.total ?? 0) === 0)
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
          {showDays && <Bars label="Errors per day" data={fillDays(days, byDay)} fmt={fmtInt} marks={deployDays} markLabel="deploy" />}
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

function UsagePanel({ overview, days, scoped = false }: { overview: Part<Overview>; days: number; scoped?: boolean }) {
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
            {scoped
              ? <Bars label="Actions per day" data={fillDays(days, o.activity_by_day.reduce((m, d) => m.set(d.day, (m.get(d.day) ?? 0) + d.events), new Map<string, number>()))} fmt={fmtInt} />
              : <Bars label="People signing in per day" data={fillDays(days, new Map(o.signins_by_day.map(d => [d.day, d.users])))} fmt={fmtInt} />}
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

/** Every pg_cron job in the shared database: mail, bells, KPI settling, housekeeping (ops_cron(), KPI 0300). */
function CronPanel({ cron }: { cron: Part<CronJob[]> }) {
  return (
    <Panel id="cron" title="Scheduled jobs" note="Jobs the shared database runs by itself, last 24 hours.">
      <Waiting part={cron} off="Not set up yet: KPI migration 0300 has not been applied.">
        {jobs => {
          const failing = jobs.filter(j => j.failed_24h > 0)
          return (
            <>
              <Stats items={[{ label: 'Jobs', value: fmtInt(jobs.length) },
                             { label: 'Runs, 24 h', value: fmtInt(jobs.reduce((n, j) => n + j.runs_24h, 0)) },
                             { label: 'Failed runs, 24 h', value: fmtInt(failing.reduce((n, j) => n + j.failed_24h, 0)) }]} />
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <caption>By job, failing first</caption>
                  <thead><tr><th>Job</th><th>Schedule</th><th>Last run</th><th className="num">Runs</th><th className="num">Failed</th><th className="num">Avg s</th><th>Last failure</th></tr></thead>
                  <tbody>
                    {jobs.map(j => (
                      <tr key={j.name}>
                        <td className="ops-mono">{j.name}{!j.active && ' (paused)'}</td>
                        <td className="ops-mono">{j.schedule}</td>
                        <td className={j.last_status === 'failed' ? 'down' : undefined}>{j.last_at ? ago(j.last_at) : '—'}</td>
                        <td className="num">{fmtInt(j.runs_24h)}</td>
                        <td className={j.failed_24h > 0 ? 'num down' : 'num'}>{fmtInt(j.failed_24h)}</td>
                        <td className="num">{j.avg_s ?? '—'}</td>
                        <td>{j.last_error ? `${ago(j.last_error_at!)}: ${j.last_error}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

/** Cyra's spend from its own meter, Pulse's and BEMMP's from the shared database (KPI 0236), on one bill. */
function AiPanel({ ai, aiApps, days }: { ai: Part<AiData>; aiApps: Part<AiApps>; days: number }) {
  if (ai.state === 'loading' || aiApps.state === 'loading') return <Panel id="ai" title="AI cost"><div className="ops-skeleton" /></Panel>
  const cyra = ai.state === 'ok' ? ai.data : null
  const apps = aiApps.state === 'ok' ? aiApps.data : null
  const problems = [
    ai.state === 'failed' && `Cyra Assist: ${ai.error}`,
    ai.state === 'off' && 'Cyra Assist is not connected: CYRA_SUPABASE_URL and CYRA_SERVICE_KEY are not on the portal.',
    aiApps.state === 'failed' && `Pulse and BEMMP: ${aiApps.error}`,
    aiApps.state === 'off' && 'Pulse and BEMMP are not metered yet: KPI migration 0236 is not applied.',
  ].filter(Boolean) as string[]

  const perDay = new Map<string, number>()
  for (const d of cyra?.by_day ?? []) perDay.set(d.key, (perDay.get(d.key) ?? 0) + d.cost)
  for (const d of apps?.by_day ?? []) perDay.set(d.day, (perDay.get(d.day) ?? 0) + d.cost)
  const cost = (cyra?.cost ?? 0) + (apps?.cost ?? 0)
  const calls = (cyra?.calls ?? 0) + (apps?.calls ?? 0)
  const byApp: Spend[] = [
    ...(cyra && cyra.calls > 0 ? [{ key: 'Cyra Assist', calls: cyra.calls, tokens: cyra.by_model.reduce((t, m) => t + m.tokens, 0), cost: cyra.cost }] : []),
    ...(apps?.by_app ?? []).map(x => ({ key: MODULE_NAMES[x.key] ?? x.key, calls: x.calls, tokens: x.tokens, cost: x.cost })),
  ].sort((x, y) => y.cost - x.cost)
  const byModel: Spend[] = [
    ...(cyra?.by_model ?? []).map(m => ({ ...m, key: `cyra · ${m.key}` })),
    ...(apps?.by_model ?? []).map(m => ({ key: m.key, calls: m.calls, tokens: m.tokens, cost: m.cost })),
  ].sort((x, y) => y.cost - x.cost)
  const byFeature: Spend[] = [
    ...(cyra?.by_route ?? []).map(m => ({ ...m, key: `cyra · ${m.key}` })),
    ...(apps?.by_feature ?? []),
  ].sort((x, y) => y.cost - x.cost)

  return (
    <Panel id="ai" title="AI cost" note="Estimated from each app's own meter and the price tables. Sarvam speech is priced from sarvam.ai's list.">
      {problems.map(p => <p key={p} className="ops-off">{p}</p>)}
      {(cyra || apps) && (
        <>
          <Stats items={[{ label: `Cost, last ${days} days`, value: fmtUsd(cost) },
                         { label: 'Calls', value: fmtInt(calls) },
                         { label: 'Per day, average', value: fmtUsd(cost / days) }]} />
          {apps && apps.unpriced.length > 0 && (
            <p className="ops-note">No price set for {apps.unpriced.join(', ')}: counted, not costed. Add a row to ops_ai_price.</p>
          )}
          {cyra?.sarvam && (cyra.sarvam.tts.calls > 0 || cyra.sarvam.stt.calls > 0) && (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <caption>Sarvam AI (Cyra voice)</caption>
                <thead><tr><th>Use</th><th>Calls</th><th>Characters</th><th>Cost</th></tr></thead>
                <tbody>
                  <tr><td>Text to speech (bulbul)</td><td>{fmtInt(cyra.sarvam.tts.calls)}</td><td>{fmtInt(cyra.sarvam.tts.chars)}</td>
                      <td>₹{fmtInt(Math.round(cyra.sarvam.tts.inr))}</td></tr>
                  <tr><td>Speech to text (saaras)</td><td>{fmtInt(cyra.sarvam.stt.calls)}</td><td>{fmtInt(cyra.sarvam.stt.chars)}</td>
                      <td>≈ ₹{fmtInt(Math.round(cyra.sarvam.stt.inr))}</td></tr>
                </tbody>
              </table>
              <p className="ops-note">Text to speech at ₹3 per 1,000 characters. Speech to text at ₹0.49 a minute, with minutes
                estimated from the transcript length (the engine does not record the audio length). GST extra.</p>
            </div>
          )}
          <Bars label={`Cost per day (USD, ₹${usdInr} per $)`} data={fillDays(days, perDay)} fmt={fmtUsd} />
          <SpendTable caption="By app" rows={byApp} />
          <div className="ops-two">
            <SpendTable caption="By model" rows={byModel} />
            <SpendTable caption="By feature" rows={byFeature} />
          </div>
        </>
      )}
    </Panel>
  )
}

/** The 9 Oct audit's findings, measured nightly-ish (KPI 0237): testing_mode, default passwords, what is stored. */
function SecurityPanel({ security }: { security: Part<SecurityData> }) {
  return (
    <Panel id="security" title="Security" note="Passwords are checked against the issued default, about every 3 hours. Only yes or no is kept.">
      <Waiting part={security} off="Not set up yet: KPI migration 0237 has not been applied.">
        {sec => {
          const testing = sec.testing_mode === true || sec.testing_mode === 'true'
          const storage = sec.storage.reduce((t, b) => t + b.bytes, 0)
          const pct = sec.checked ? Math.round((100 * sec.default_pw) / sec.checked) : null
          return (
            <>
              <Stats items={[
                { label: 'testing_mode', value: testing ? 'On' : 'Off' },
                { label: 'On default password', value: pct === null ? '—' : `${fmtInt(sec.default_pw)} (${pct}%)` },
                { label: 'Must change at sign-in', value: fmtInt(sec.must_change) },
                { label: 'Database + files', value: `${fmtBytes(sec.db_bytes)} + ${fmtBytes(storage)}` },
              ]} />
              {sec.checked < sec.accounts && (
                <p className="ops-note">Checked {fmtInt(sec.checked)} of {fmtInt(sec.accounts)} accounts so far; the rest within about 3 hours.</p>
              )}
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <caption>Admin accounts</caption>
                  <thead><tr><th>Account</th><th>Roles</th><th>Password</th></tr></thead>
                  <tbody>
                    {sec.admins.map(a => (
                      <tr key={a.code}>
                        <td>{a.code} · {a.name}</td>
                        <td className="ops-mono">{a.roles.join(', ')}</td>
                        <td className={a.default_pw ? 'down' : undefined}>{a.default_pw == null ? 'Not checked yet' : a.default_pw ? 'Default' : 'Changed'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ops-note">
                Supabase keeps 7 days of database backups. Uploaded files ({fmtBytes(storage)}) are not backed up anywhere.
              </p>
            </>
          )
        }}
      </Waiting>
    </Panel>
  )
}

/**
 * Where things run and how the shared database is holding up. Region and request counts need SUPABASE_ACCESS_TOKEN on
 * the portal; page views need Web Analytics switched on per Vercel project. Everything else needs nothing.
 */
/**
 * Published sizes, so a row can say what a plan name means (the user, 21 Nov: "showcase the compute"). Checked
 * against each provider's pricing page in Nov 2026; a plan the table does not know shows its name alone.
 */
const SUPABASE_SIZES: Record<string, { ram: string; cpu: string; usd: number; conns: number }> = {
  Micro: { ram: '1 GB', cpu: '2-core ARM, shared', usd: 10, conns: 60 },
  Small: { ram: '2 GB', cpu: '2-core ARM, shared', usd: 15, conns: 90 },
  Medium: { ram: '4 GB', cpu: '2-core ARM, shared', usd: 60, conns: 120 },
  Large: { ram: '8 GB', cpu: '2-core ARM, dedicated', usd: 110, conns: 160 },
  XL: { ram: '16 GB', cpu: '4-core ARM, dedicated', usd: 210, conns: 240 },
  '2XL': { ram: '32 GB', cpu: '8-core ARM, dedicated', usd: 410, conns: 380 },
  '4XL': { ram: '64 GB', cpu: '16-core ARM, dedicated', usd: 960, conns: 480 },
}
const RENDER_PLANS: Record<string, { ram: string; cpu: string; usd: number; note?: string }> = {
  free: { ram: '512 MB', cpu: '0.1 CPU', usd: 0, note: 'sleeps after 15 min idle' },
  starter: { ram: '512 MB', cpu: '0.5 CPU', usd: 7 },
  standard: { ram: '2 GB', cpu: '1 CPU', usd: 25 },
  pro: { ram: '4 GB', cpu: '2 CPU', usd: 85 },
}
const VERCEL_MEMORY: Record<string, string> = { standard: '2 GB, 1 vCPU', performance: '4 GB, 2 vCPU' }
const cap = (x: string) => x ? x[0].toUpperCase() + x.slice(1) : x

/** A Supabase size from its name, or from max_connections when no account token says the name. */
function supabaseSize(name: string | null | undefined, maxConns: number | null | undefined) {
  const key = name ? Object.keys(SUPABASE_SIZES).find(k => k.toLowerCase() === name.replace(/^ci_/, '').toLowerCase()) : undefined
  if (key) return { name: key, ...SUPABASE_SIZES[key], inferred: false }
  const byConns = maxConns ? Object.entries(SUPABASE_SIZES).find(([, v]) => v.conns === maxConns) : undefined
  return byConns ? { name: byConns[0], ...byConns[1], inferred: true } : null
}

interface ComputeRow { host: string; runs: string; size: string; region: string; now: string; warn?: boolean }

/** One row per place something of ours runs: Vercel, both Supabase projects, Render, cyrix-svc01. */
function computeRows(i: InfraData | null, d: DbData | null, p: PulseData | null): ComputeRow[] {
  const c = i?.compute
  const rows: ComputeRow[] = []

  const v = c?.vercel
  const mem = v?.memory ? (VERCEL_MEMORY[v.memory] ?? v.memory) : null
  rows.push({
    host: `Vercel${v?.plan ? ` (${cap(v.plan)})` : ''}`,
    runs: `${v?.projects ?? 9} web apps and their API functions`,
    size: [mem ? `Functions ${mem}` : null, v?.fluid ? 'Fluid compute' : null, v?.timeout_s ? `${v.timeout_s}s limit` : null]
      .filter(Boolean).join(', ') || (v?.failed ? 'Vercel API did not answer' : 'Serverless, sized per request'),
    region: (v?.regions?.length ? v.regions : [i?.function_region ?? null]).map(regionName).join(', '),
    now: '—',
  })

  const conns = d ? Object.values(d.connections).reduce((n, x) => n + x, 0) : null
  const shared = supabaseSize(c?.supabase.shared?.size, d?.max_connections)
  rows.push({
    host: 'Supabase, shared database',
    runs: 'Login, KPI, Travel, Revive, My Task, Workplace, Projects, BEMMP, Spare',
    size: shared ? `${shared.name}${shared.inferred ? ' (from its connection limit)' : ''}: ${shared.ram}, ${shared.cpu}, $${shared.usd}/mo` : '—',
    region: regionName(c?.supabase.shared?.region ?? i?.supabase.region ?? 'ap-south-1'),
    now: d && conns !== null ? `${fmtInt(conns)} of ${fmtInt(d.max_connections)} connections` : '—',
    warn: Boolean(d && conns !== null && conns >= 0.8 * d.max_connections),
  })

  const cy = supabaseSize(c?.supabase.cyra?.size, null)
  rows.push({
    host: 'Supabase, Cyra database',
    runs: 'Cyra Assist (its own project and logins)',
    size: cy ? `${cy.name}: ${cy.ram}, ${cy.cpu}, $${cy.usd}/mo` : 'Needs SUPABASE_ACCESS_TOKEN',
    region: regionName(c?.supabase.cyra?.region ?? 'ap-south-1'),
    now: c?.supabase.cyra?.status ? cap(c.supabase.cyra.status.replace(/_/g, ' ').toLowerCase()) : '—',
  })

  const live = Boolean(c?.render?.length)
  const engines = live ? c!.render! : [{ name: 'cyra-diagnostic-chat', type: 'web_service', suspended: false, plan: 'free', region: null, instances: null }]
  for (const r of engines) {
    const plan = r.plan ? RENDER_PLANS[r.plan] : undefined
    rows.push({
      host: `Render${r.plan ? ` (${cap(r.plan)})` : ''}`,
      runs: r.name === 'cyra-diagnostic-chat' ? 'Cyra engine (AI guide)' : r.name,
      size: plan ? [plan.ram, plan.cpu, plan.usd ? `$${plan.usd}/mo` : null, plan.note].filter(Boolean).join(', ') : (r.plan ?? '—'),
      region: r.region ? cap(r.region) : '—',
      now: r.suspended ? 'Suspended' : (live ? 'Running' : '—'),
      warn: r.suspended,
    })
  }

  const h = p?.host
  const memTotal = h?.memory?.total_bytes ?? null
  const memUsed = memTotal !== null && h?.memory?.available_bytes != null ? memTotal - h.memory.available_bytes : null
  const load = h?.load?.[1] ?? null
  rows.push({
    host: 'cyrix-svc01 (office server)',
    runs: 'Pulse, SAP sync, SQL Server, Caddy',
    size: h ? [h.cpus ? `${h.cpus} cores` : null, memTotal ? `${fmtBytes(memTotal)} RAM` : null,
               p?.disk ? `${fmtBytes(p.disk.total_bytes)} disk` : null].filter(Boolean).join(', ') || '—'
            : 'Shows after the next Pulse rebuild',
    region: 'Office (on-prem)',
    now: [load !== null && h?.cpus ? `load ${load} on ${h.cpus} cores` : null,
          memUsed !== null && memTotal ? `memory ${Math.round(100 * memUsed / memTotal)}% used` : null,
          p?.disk?.free_pct != null ? `disk ${p.disk.free_pct}% free` : null,
          h?.booted_at ? `booted ${ago(h.booted_at)}` : null].filter(Boolean).join(', ') || '—',
    warn: Boolean((load !== null && h?.cpus && load >= h.cpus) || (p?.disk?.free_pct != null && p.disk.free_pct < 10)),
  })
  return rows
}

function InfraPanel({ infra, db, pulse, browserMs }: { infra: Part<InfraData>; db: Part<DbData>; pulse: Part<PulseData>; browserMs: number | null }) {
  const i = infra.state === 'ok' ? infra.data : null
  const d = db.state === 'ok' ? db.data : null
  const p = pulse.state === 'ok' ? pulse.data : null
  const compute = computeRows(i, d, p)
  const conns = d ? Object.values(d.connections).reduce((n, x) => n + x, 0) : 0
  const views = i?.analytics.apps?.filter(a => a.enabled) ?? []
  const notOn = i?.analytics.apps?.filter(a => !a.enabled) ?? []
  return (
    <Panel id="infra" title="Infrastructure" note="Where each part runs, how far the database is from you, and what is costing it time.">
      {infra.state === 'failed' && <p className="ops-off">Portal: {infra.error}</p>}
      {db.state === 'failed' && <p className="ops-off">Database: {db.error}</p>}
      {db.state === 'off' && <p className="ops-off">Database figures need KPI migration 0241.</p>}
      <Stats items={[
        { label: 'Database region', value: regionName(i?.supabase.region ?? 'ap-south-1') },
        { label: 'You to database', value: browserMs === null ? '—' : `${fmtInt(browserMs)} ms` },
        { label: 'Portal server', value: regionName(i?.function_region) },
        { label: 'Server to database', value: i?.db_ms == null ? '—' : `${fmtInt(i.db_ms)} ms` },
        ...(d ? [
          { label: 'Connections', value: `${fmtInt(conns)} of ${fmtInt(d.max_connections)}` },
          { label: 'Cache hit', value: d.cache_hit_pct == null ? '—' : `${d.cache_hit_pct}%` },
          { label: 'Database size', value: fmtBytes(d.size_bytes) },
          { label: 'Last restart', value: ago(d.started) },
        ] : []),
      ]} />
      <div className="ops-table-wrap">
        <table className="ops-table">
          <caption>Compute: what each part runs on</caption>
          <thead><tr><th>Host</th><th>Runs</th><th>Size</th><th>Region</th><th>Now</th></tr></thead>
          <tbody>
            {compute.map(r => (
              <tr key={r.host + r.runs}><td>{r.host}</td><td>{r.runs}</td><td>{r.size}</td><td>{r.region}</td>
                <td className={r.warn ? 'down' : undefined}>{r.now}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {i && !i.compute?.supabase.cyra && !i.compute?.render?.length && (
        <p className="ops-note">Without a provider key, sizes come from each plan's published figures: the shared database's from its connection limit, Render's from Cyra's render.yaml. SUPABASE_ACCESS_TOKEN and RENDER_API_KEY on the portal's Vercel project make them live.</p>
      )}
      {(i?.supabase.region ?? 'ap-south-1') !== 'ap-south-1' && (
        <p className="ops-note">The database is outside India, so every request makes the round trip above. Mumbai (ap-south-1) would cut it, but moving means a new project.</p>
      )}
      {i && !i.supabase.configured && (
        <p className="ops-note">Supabase request counts need SUPABASE_ACCESS_TOKEN on the portal's Vercel project (Supabase, Account, Access tokens).</p>
      )}
      {i?.supabase.failed && <p className="ops-off">Supabase API: {i.supabase.failed}</p>}
      {i?.supabase.requests_7d && (
        <Stats items={[
          { label: 'API requests, 7 days', value: fmtInt(i.supabase.requests_7d.rest) },
          { label: 'Auth requests', value: fmtInt(i.supabase.requests_7d.auth) },
          { label: 'Storage requests', value: fmtInt(i.supabase.requests_7d.storage) },
          { label: 'Realtime', value: fmtInt(i.supabase.requests_7d.realtime) },
        ]} />
      )}
      {d && d.slow.length > 0 && (
        <div className="ops-table-wrap">
          <table className="ops-table">
            <caption>What costs the database the most time, since its last restart</caption>
            <thead><tr><th>Query</th><th className="num">Calls</th><th className="num">Average</th><th className="num">Total</th></tr></thead>
            <tbody>
              {d.slow.map((q, k) => (
                <tr key={k}><td className="ops-mono">{q.query}</td><td className="num">{fmtInt(q.calls)}</td>
                  <td className={q.mean_ms >= 1000 ? 'num down' : 'num'}>{fmtInt(Math.round(q.mean_ms))} ms</td>
                  <td className="num">{fmtInt(Math.round(q.total_s / 60))} min</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d && d.tables.length > 0 && (
        <div className="ops-table-wrap">
          <table className="ops-table">
            <caption>Largest tables</caption>
            <thead><tr><th>Table</th><th className="num">Rows</th><th className="num">Size</th></tr></thead>
            <tbody>{d.tables.map(t => <tr key={t.name}><td className="ops-mono">{t.name}</td><td className="num">{fmtInt(t.rows)}</td><td className="num">{fmtBytes(t.bytes)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {views.length > 0 && (
        <div className="ops-table-wrap">
          <table className="ops-table">
            <caption>Page views (Vercel Web Analytics)</caption>
            <thead><tr><th>App</th><th className="num">Views</th><th className="num">Visitors</th></tr></thead>
            <tbody>{views.map(a => <tr key={a.app}><td>{MODULE_NAMES[a.app] ?? a.app}</td><td className="num">{fmtInt(a.views ?? 0)}</td><td className="num">{a.visitors == null ? '—' : fmtInt(a.visitors)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {notOn.length > 0 && (
        <p className="ops-note">Vercel Web Analytics is off for {notOn.map(a => MODULE_NAMES[a.app] ?? a.app).join(', ')}. Sign-ins and actions are under Usage.</p>
      )}
    </Panel>
  )
}

/** One workbook, a sheet per section, of exactly what the page is showing (filter and period included). */
async function buildReport(r: {
  days: number; app: string; health: Part<HealthData>; uptime: Part<Uptime>; appErrors: Part<AppErrors>; errors: Part<ErrorsData>
  overview: Part<Overview>; ai: Part<AiData>; aiApps: Part<AiApps>; deploys: Part<DeploysData>; changes: Part<ChangesData>
  pulse: Part<PulseData>; security: Part<SecurityData>; infra: Part<InfraData>; db: Part<DbData>; browserMs: number | null
}): Promise<Blob> {
  const ok = <T,>(p: Part<T>) => p.state === 'ok' ? p.data : null
  const col = (header: string, key: string, numeric = false) => ({ header, key, numeric })
  const sheets: XlsxSheet[] = [{
    name: 'About', columns: [col('Field', 'k'), col('Value', 'v')],
    rows: [{ k: 'Report', v: 'Cyrix Ops' }, { k: 'App', v: r.app === 'all' ? 'All apps' : (appOf(r.app)?.name ?? r.app) },
           { k: 'Period', v: `Last ${r.days} days` }, { k: 'Exported (IST)', v: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) },
           { k: 'USD to INR', v: String(usdInr) }],
  }]
  const h = ok(r.health)
  if (h) sheets.push({ name: 'Status', columns: [col('App', 'name'), col('Group', 'group'), col('Up', 'up'), col('HTTP', 'status', true), col('ms', 'ms', true), col('Problem', 'problem')],
    rows: h.checks.map(c => ({ ...c, up: c.ok ? 'yes' : 'no' })) })
  const u = ok(r.uptime)
  if (u) {
    sheets.push({ name: 'Uptime', columns: [col('App', 'name'), col('Group', 'group'), col('Uptime %', 'uptime', true), col('Checks', 'checks', true), col('Down now', 'down')],
      rows: u.targets.map(t => ({ ...t, down: t.down_now ? 'yes' : 'no' })) })
    sheets.push({ name: 'Outages', columns: [col('App', 'target'), col('Started', 'started_at'), col('Ended', 'ended_at'), col('Minutes', 'minutes', true), col('Problem', 'problem')],
      rows: u.incidents })
  }
  const e = ok(r.appErrors), ce = ok(r.errors)
  sheets.push({ name: 'Errors', columns: [col('App', 'app'), col('Message', 'message'), col('Where', 'where'), col('Count', 'count', true), col('People', 'people', true), col('Last', 'last')],
    rows: [...(e?.groups ?? []).map(g => ({ app: MODULE_NAMES[g.app] ?? g.app, message: g.message, where: g.route, count: g.count, people: g.people, last: g.last })),
           ...(ce?.groups ?? []).map(g => ({ app: 'Cyra Assist', message: g.message, where: g.routes.join(', '), count: g.count, last: g.last }))] })
  const o = ok(r.overview)
  if (o) sheets.push({ name: 'Usage', columns: [col('Module', 'module'), col('People', 'users', true), col('Actions', 'events', true)],
    rows: o.active_by_module.map(m => ({ ...m, module: MODULE_NAMES[m.module] ?? m.module })) })
  const ca = ok(r.ai), aa = ok(r.aiApps)
  sheets.push({ name: 'AI cost', columns: [col('Item', 'key'), col('Calls', 'calls', true), col('Tokens', 'tokens', true), col('USD', 'usd', true), col('INR', 'inr', true)],
    rows: [...(ca?.by_model ?? []).map(m => ({ ...m, key: `cyra · ${m.key}` })), ...(aa?.by_model ?? [])]
      .map(m => ({ key: m.key, calls: m.calls, tokens: m.tokens, usd: Number(m.cost.toFixed(4)), inr: Math.round(m.cost * usdInr * 100) / 100 })) })
  const p = ok(r.pulse)
  if (p) sheets.push({ name: 'Pulse sync', columns: [col('Job', 'job'), col('Every (h)', 'every_hours', true), col('Age (h)', 'age_hours', true), col('Late', 'late')],
    rows: p.sync.map(j => ({ ...j, late: j.late ? 'yes' : 'no' })) })
  const s = ok(r.security)
  if (s) sheets.push({ name: 'Security', columns: [col('Account', 'code'), col('Name', 'name'), col('Roles', 'roles'), col('Default password', 'pw')],
    rows: s.admins.map(a => ({ code: a.code, name: a.name, roles: a.roles.join(', '), pw: a.default_pw == null ? 'not checked' : a.default_pw ? 'YES' : 'no' })) })
  const d = ok(r.db)
  if (d) sheets.push({ name: 'Database', columns: [col('Query', 'query'), col('Calls', 'calls', true), col('Average ms', 'mean_ms', true), col('Total s', 'total_s', true)], rows: d.slow })
  const dep = ok(r.deploys)
  if (dep) sheets.push({ name: 'Deploys', columns: [col('Project', 'project'), col('State', 'state'), col('At', 'at'), col('Commit', 'sha'), col('Message', 'message')], rows: dep.deploys })
  const ch = ok(r.changes)
  if (ch) sheets.push({ name: 'Commits', columns: [col('Repo', 'repo'), col('At', 'at'), col('Author', 'author'), col('Message', 'message'), col('Commit', 'sha')], rows: ch.commits })
  return writeBook(sheets)
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
function Bars({ label, data, fmt, marks, markLabel = 'mark' }: { label: string; data: { day: string; value: number }[]; fmt: (n: number) => string
                                                         marks?: Map<string, number>; markLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map(d => d.value))
  const W = 100 / data.length
  const shown = hover ?? data.length - 1
  return (
    <figure className="ops-bars">
      <figcaption>
        <span>{label}</span>
        <span className="ops-bars-read">{shortDay(data[shown].day)}: <strong>{fmt(data[shown].value)}</strong>
          {marks?.get(data[shown].day) ? ` · ${marks.get(data[shown].day)} ${markLabel}${marks.get(data[shown].day) === 1 ? '' : 's'}` : ''}</span>
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
              {marks?.get(d.day) ? <rect x={i * W + W * 0.3} y="0" width={W * 0.4} height="2" className="ops-bar-mark" /> : null}
            </g>
          )
        })}
      </svg>
      <div className="ops-bars-x"><span>{shortDay(data[0].day)}</span>
        {marks && marks.size > 0 && <span className="ops-bars-key"><i className="ops-bar-mark-key" /> day with a {markLabel}</span>}
        <span>{shortDay(data[data.length - 1].day)}</span></div>
    </figure>
  )
}
