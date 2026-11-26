/**
 * /api/heartbeat — the one check that lives outside the shared database (the user, 19 Nov 2026).
 *
 * The Ops page's uptime round runs inside the shared database (pg_cron, every 5 minutes). When that database is out
 * of connections or down, the round stops, and so does every alert that would have said so. This endpoint is for an
 * outside pinger (UptimeRobot, Better Stack or similar, every 5 minutes) to call:
 *
 *   200 "ok"            the database answered and its last round is under 20 minutes old (a round stores its
 *                       results when the next one starts, so 5-10 minutes is the normal age)
 *   503 <reason>        either the database did not answer, or the round has stopped
 *
 * No session is needed and nothing but that one word or reason is returned. It asks ops_heartbeat() (KPI 0301) with
 * the public anon key, which answers one number: seconds since the last stored check. No service key is held here.
 * One call costs one function invocation and one small database read, so a 5-minute pinger is about 8,600 calls a
 * month.
 */

const URL_BASE = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const STALE_S = 20 * 60

function reply(res, status, text) {
  res.status(status)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(text)
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'GET only')
  if (!URL_BASE || !KEY) return reply(res, 503, 'not configured')
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/ops_heartbeat`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) return reply(res, 503, `database answered ${r.status}`)
    const age = Number(await r.json())
    if (!Number.isFinite(age) || age < 0) return reply(res, 503, 'no uptime round in the last day')
    if (age > STALE_S) return reply(res, 503, `uptime round stopped ${Math.round(age / 60)} min ago`)
    return reply(res, 200, 'ok')
  } catch {
    return reply(res, 503, 'database did not answer')
  }
}
