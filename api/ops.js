/**
 * /api/ops — the half of the Ops page a browser cannot do by itself (KPI 0227; the user, 30 Oct).
 *
 *   GET /api/ops?part=health          ping every app, both databases and the two servers we run ourselves
 *   GET /api/ops?part=deploys&days=N  Vercel production deployments across the team
 *   GET /api/ops?part=changes&days=N  commits across the repos, newest first
 *   GET /api/ops?part=errors&days=N   CYRA's app_error, grouped by message
 *   GET /api/ops?part=ai&days=N       CYRA's metered AI usage and cost
 *
 * Usage figures from the shared database do not come through here: the page asks ops_overview() with its own
 * session, and the database refuses anyone who is not an Ops admin.
 *
 * Who may call: whoever is_ops_admin() says yes to, asked with the caller's own token and the public anon key.
 * So the database decides, as it does for the page, and this function holds no key to the shared database at all.
 *
 * The keys it does hold are read from the environment, used, and never returned, logged or echoed in an error:
 *   VERCEL_TOKEN (+ VERCEL_TEAM_ID)  a read-only token for team cyrix4
 *   GITHUB_TOKEN                     a fine-grained, read-only (contents + metadata) token for the repos
 *   CYRA_SUPABASE_URL, CYRA_SERVICE_KEY  CYRA's own project, read with Accept-Profile: cyra_v2
 * A part whose key is missing answers { configured: false } rather than failing, so the page can say so.
 *
 * Every answer is counts, names of apps and commit messages. No ticket, score, prompt or stack trace leaves here.
 */

const SHARED_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SHARED_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const CYRA_URL = process.env.CYRA_SUPABASE_URL || ''
const CYRA_KEY = process.env.CYRA_SERVICE_KEY || ''
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || ''
const VERCEL_TEAM = process.env.VERCEL_TEAM_ID || 'team_yvvPM8g0ikIafJ2RCnZGMga3'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const ORG = 'CYRIX-Healthcare-Pvt-Ltd'
const REPOS = (process.env.OPS_REPOS ||
  'cyrix-platform,Cyrix-KPI,Cyrix-Spare-Mapping,Cyrix-Bemmp-Dashboard,Cyrix-Revive-Lab,cyrix-travel,cyrix-task,Cyrix-Cyra,Cyrix-Pulse')
  .split(',').map(s => s.trim()).filter(Boolean)

/**
 * What "up" means for each thing we run. A Vercel module is up when its own deployment answers its own path —
 * asked directly, not through app.cyrix.in, so a broken rewrite and a broken app read as different rows.
 * CYRA's engine is on Render's free plan and sleeps, so it gets longer before it counts as down.
 */
const TARGETS = [
  { id: 'portal', name: 'Portal', group: 'Vercel', url: 'https://app.cyrix.in/' },
  { id: 'kpi', name: 'KPI', group: 'Vercel', url: 'https://cyrix-kpi.vercel.app/kpi/' },
  { id: 'spare', name: 'Spare Mapping', group: 'Vercel', url: 'https://cyrix-spare-mapping.vercel.app/spare/' },
  { id: 'bemmp', name: 'BEMMP Dashboard', group: 'Vercel', url: 'https://cyrix-bemmp-dashboard.vercel.app/bemmp/' },
  { id: 'revive', name: 'Revive Lab', group: 'Vercel', url: 'https://cyrix-revive-lab.vercel.app/revive/' },
  { id: 'travel', name: 'Travel Expense', group: 'Vercel', url: 'https://cyrix-travel.vercel.app/travel/' },
  { id: 'tasks', name: 'My Task', group: 'Vercel', url: 'https://cyrix-task.vercel.app/tasks/' },
  { id: 'cyra', name: 'Cyra Assist', group: 'Vercel', url: 'https://cyrix-cyra.vercel.app/cyra/' },
  { id: 'cyra-engine', name: 'Cyra engine', group: 'Render', url: 'https://cyra-diagnostic-chat-1.onrender.com/api/health', timeout: 25_000 },
  { id: 'pulse', name: 'Pulse API', group: 'cyrix-svc01', url: 'https://pulse.cyrix.in/pulse/api/health' },
  { id: 'oneview', name: 'OneView (Streamlit)', group: 'cyrix-svc01', url: 'https://oneview.cyrix.in/' },
  { id: 'db-shared', name: 'Shared database', group: 'Supabase', url: `${SHARED_URL}/auth/v1/health`, key: SHARED_ANON },
  ...(CYRA_URL ? [{ id: 'db-cyra', name: 'Cyra database', group: 'Supabase', url: `${CYRA_URL}/auth/v1/health`, key: CYRA_KEY }] : []),
]

function send(res, status, body) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json')
  // Per person and changing by the minute: nothing between here and the browser may keep a copy.
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(JSON.stringify(body))
}

async function timed(url, init = {}, ms = 10_000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(t)
  }
}

/** Yes only when the shared database says this token belongs to an Ops admin. Anything else is no. */
async function isOpsAdmin(req) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ') || !SHARED_URL || !SHARED_ANON) return false
  try {
    const r = await timed(`${SHARED_URL}/rest/v1/rpc/is_ops_admin`, {
      method: 'POST',
      headers: { apikey: SHARED_ANON, Authorization: header, 'Content-Type': 'application/json' },
      body: '{}',
    }, 8_000)
    return r.ok && (await r.json()) === true
  } catch {
    return false
  }
}

const sinceDays = days => new Date(Date.now() - days * 86_400_000)

/* ---- parts --------------------------------------------------------------------------------------------- */

async function health() {
  const checked = await Promise.all(TARGETS.map(async t => {
    const started = Date.now()
    try {
      const r = await timed(t.url, {
        headers: t.key ? { apikey: t.key } : {},
        redirect: 'follow',
      }, t.timeout ?? 10_000)
      return { id: t.id, name: t.name, group: t.group, ok: r.status < 500, status: r.status, ms: Date.now() - started }
    } catch (e) {
      const timeout = e?.name === 'AbortError'
      return { id: t.id, name: t.name, group: t.group, ok: false, status: null, ms: Date.now() - started,
               problem: timeout ? 'No answer in time' : 'Could not connect' }
    }
  }))
  return { configured: true, at: new Date().toISOString(), checks: checked }
}

async function deploys(days) {
  if (!VERCEL_TOKEN) return { configured: false }
  const q = new URLSearchParams({ teamId: VERCEL_TEAM, target: 'production', limit: '100',
                                  since: String(sinceDays(days).getTime()) })
  const r = await timed(`https://api.vercel.com/v6/deployments?${q}`, { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } })
  if (!r.ok) return { configured: true, failed: `Vercel answered ${r.status}` }
  const body = await r.json()
  return {
    configured: true,
    deploys: (body.deployments ?? []).map(d => ({
      project: d.name,
      state: d.state ?? d.readyState,
      at: new Date(d.created ?? d.createdAt).toISOString(),
      message: (d.meta?.githubCommitMessage ?? '').split('\n')[0].slice(0, 200),
      sha: (d.meta?.githubCommitSha ?? '').slice(0, 7),
      author: d.meta?.githubCommitAuthorLogin ?? d.creator?.username ?? null,
    })),
  }
}

async function changes(days) {
  if (!GITHUB_TOKEN) return { configured: false }
  const since = sinceDays(days).toISOString()
  const perRepo = await Promise.all(REPOS.map(async repo => {
    try {
      const r = await timed(`https://api.github.com/repos/${ORG}/${repo}/commits?since=${since}&per_page=50`, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
                   'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'cyrix-ops' },
      })
      if (!r.ok) return { repo, failed: r.status, commits: [] }
      const list = await r.json()
      return {
        repo,
        commits: list.map(c => ({
          repo,
          sha: c.sha.slice(0, 7),
          at: c.commit?.committer?.date ?? c.commit?.author?.date,
          message: (c.commit?.message ?? '').split('\n')[0].slice(0, 200),
          author: c.author?.login ?? c.commit?.author?.name ?? null,
          url: c.html_url,
        })),
      }
    } catch {
      return { repo, failed: 'unreachable', commits: [] }
    }
  }))
  return {
    configured: true,
    repos: perRepo.map(p => ({ repo: p.repo, commits: p.commits.length, failed: p.failed ?? null })),
    commits: perRepo.flatMap(p => p.commits).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, 200),
  }
}

async function cyra(table, query) {
  const r = await timed(`${CYRA_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: CYRA_KEY, Authorization: `Bearer ${CYRA_KEY}`, 'Accept-Profile': 'cyra_v2' },
  })
  if (!r.ok) throw new Error(`Cyra database answered ${r.status}`)
  return r.json()
}

async function errors(days) {
  if (!CYRA_URL || !CYRA_KEY) return { configured: false }
  const rows = await cyra('app_error',
    `select=source,route,status,kind,message,created_at&created_at=gte.${sinceDays(days).toISOString()}&order=created_at.desc&limit=5000`)
  const groups = new Map()
  const byDay = new Map()
  for (const e of rows) {
    const message = (e.message ?? '').replace(/\s+/g, ' ').slice(0, 160)
    const key = `${e.source}|${e.kind}|${message}`
    const g = groups.get(key) ?? { app: 'cyra', source: e.source, kind: e.kind, message, routes: new Set(), count: 0,
                                   last: e.created_at, statuses: new Set() }
    g.count++
    if (e.route) g.routes.add(e.route)
    if (e.status) g.statuses.add(e.status)
    groups.set(key, g)
    const day = e.created_at.slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
  }
  return {
    configured: true,
    total: rows.length,
    truncated: rows.length === 5000,
    by_day: [...byDay].map(([day, n]) => ({ day, errors: n })).sort((a, b) => a.day.localeCompare(b.day)),
    groups: [...groups.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
      .map(g => ({ ...g, routes: [...g.routes].slice(0, 5), statuses: [...g.statuses] })),
  }
}

async function ai(days) {
  if (!CYRA_URL || !CYRA_KEY) return { configured: false }
  const since = sinceDays(days).toISOString().slice(0, 10)
  const rows = await cyra('llm_usage',
    `select=day,route,model,unit_kind,prompt_tokens,completion_tokens,cached_tokens,units,calls,est_cost&day=gte.${since}&limit=10000`)
  const add = (map, key, r) => {
    const a = map.get(key) ?? { key, calls: 0, cost: 0, tokens: 0 }
    a.calls += r.calls ?? 0
    a.cost += Number(r.est_cost ?? 0)
    a.tokens += Number(r.prompt_tokens ?? 0) + Number(r.completion_tokens ?? 0)
    map.set(key, a)
  }
  const byDay = new Map(), byModel = new Map(), byRoute = new Map()
  for (const r of rows) {
    add(byDay, r.day, r)
    add(byModel, r.model, r)
    add(byRoute, r.route, r)
  }
  const sorted = m => [...m.values()].sort((a, b) => b.cost - a.cost)
  return {
    configured: true,
    // Only CYRA meters its calls today. Pulse's AI chat and BEMMP's assistant are Phase 2.
    metered: ['cyra'],
    unmetered: ['pulse', 'bemmp'],
    cost: sorted(byDay).reduce((s, d) => s + d.cost, 0),
    calls: rows.reduce((s, r) => s + (r.calls ?? 0), 0),
    by_day: [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
    by_model: sorted(byModel),
    by_route: sorted(byRoute).slice(0, 15),
  }
}

/* ---- handler ------------------------------------------------------------------------------------------- */

const PARTS = { health, deploys, changes, errors, ai }

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' })
  if (!(await isOpsAdmin(req))) return send(res, 403, { error: 'Ops admins only.' })

  const part = String(req.query?.part ?? '')
  const run = PARTS[part]
  if (!run) return send(res, 400, { error: `part must be one of ${Object.keys(PARTS).join(', ')}` })
  const days = Math.min(180, Math.max(1, parseInt(String(req.query?.days ?? '30'), 10) || 30))

  try {
    send(res, 200, await run(days))
  } catch (e) {
    // The message is ours (a status code), never a provider's body, so it is safe to show.
    send(res, 502, { error: e instanceof Error ? e.message : 'Failed' })
  }
}
