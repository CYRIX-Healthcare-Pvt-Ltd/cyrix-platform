/**
 * /api/heartbeat — the one check that lives outside the shared database (the user, 19 Nov 2026).
 *
 * The Ops page's uptime round runs inside the shared database (pg_cron, every 5 minutes). When that database is out
 * of connections or down, the round stops, and so does every alert that would have said so. This endpoint is for an
 * outside pinger (UptimeRobot, Better Stack or similar, every 5 minutes) to call:
 *
 *   200 "ok"            the database answered and its last round is under 15 minutes old
 *   503 <reason>        either the database did not answer, or the round has stopped
 *
 * No session is needed and nothing but that one word or reason is returned. It reads one timestamp with the
 * service key, which is used and never returned, logged or echoed. One call costs one function invocation and one
 * small database read, so a 5-minute pinger is about 8,600 calls a month.
 */

const URL_BASE = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const STALE_MS = 15 * 60_000

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
    const r = await fetch(`${URL_BASE}/rest/v1/ops_check?select=at&order=at.desc&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) return reply(res, 503, `database answered ${r.status}`)
    const rows = await r.json()
    const at = rows?.[0]?.at ? Date.parse(rows[0].at) : NaN
    if (!Number.isFinite(at)) return reply(res, 503, 'no uptime round on record')
    const age = Date.now() - at
    if (age > STALE_MS) return reply(res, 503, `uptime round stopped ${Math.round(age / 60_000)} min ago`)
    return reply(res, 200, 'ok')
  } catch {
    return reply(res, 503, 'database did not answer')
  }
}
