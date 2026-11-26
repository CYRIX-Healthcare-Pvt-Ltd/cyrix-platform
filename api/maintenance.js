/**
 * /api/maintenance — the maintenance switch's schedule, for apps with no session on the shared database (KPI 0305).
 *
 * Every Cyrix app draws "Cyra is under maintenance" from src/lib/maintenance.ts. Most read the switch with their
 * own session (platform_maintenance()). Cyra cannot: it signs in against its own Supabase project. It reads this.
 *
 * Answers platform_maintenance_status(): on, from, to, apps, notice_min and the database's clock. Never who set it.
 * Asked with the public anon key; no service key is held here.
 *
 * Cached at Vercel's edge for 30 seconds, so however many Cyra tabs are open, the database is asked about twice a
 * minute at most. The screen can therefore come up to 30 seconds after From, which is why the notice bar exists.
 * CORS is open: the answer is public, and Cyra may be opened on its own vercel.app address.
 */

const URL_BASE = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

function reply(res, status, body, cache) {
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', cache ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=30' : 'no-store')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'GET only' })
  if (!URL_BASE || !KEY) return reply(res, 503, { error: 'not configured' })
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/platform_maintenance_status`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) return reply(res, 503, { error: `database answered ${r.status}` })
    return reply(res, 200, await r.json(), true)
  } catch {
    return reply(res, 503, { error: 'database did not answer' })
  }
}
