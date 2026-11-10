import { useEffect, useMemo, useState } from 'react'
import { Crown } from 'lucide-react'
import { supabase } from './lib/supabase'
import './rankone.css'

/*
  Team rank 1 on the portal home (the user, 10 Nov: "what about adding that golden dust in platform also?"): the same
  rule as KPI's gold Dashboard header — rank 1 by total score in the team for the month being assessed (last month),
  from kpi_team_standing for this financial year; ties broken there (0275), and one person scored gets no gold. KPI's own rule lives in its Dashboard.tsx (champ); change both.
  Everybody else's portal stays as it is.
*/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function assessed(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  const y = today.getFullYear(), start = today.getMonth() >= 3 ? y : y - 1 // KPI's currentFy: the year of today
  return { iso, label: `${MONTHS[d.getMonth()]}-${String(d.getFullYear() % 100).padStart(2, '0')}`, fy: `${start}-${String((start + 1) % 100).padStart(2, '0')}` }
}

/** The month label ("Oct-26") when the person signed in is rank 1 in their team for the month being assessed. */
export function useRankOne(on: boolean) {
  const [month, setMonth] = useState<string | null>(null)
  useEffect(() => {
    if (!on) { setMonth(null); return }
    const a = assessed()
    let alive = true
    void supabase.rpc('kpi_team_standing', { p_fy: a.fy }).then(({ data }) => {
      if (!alive) return
      const rows = (data ?? []) as Array<{ is_me: boolean; period_month: string | null; team_rank: number | null; team_of: number | null }>
      setMonth(rows.some(r => r.is_me && r.period_month?.slice(0, 10) === a.iso && r.team_rank === 1 && (r.team_of ?? 0) > 1) ? a.label : null)
    }, () => {})
    return () => { alive = false }
  }, [on])
  return month
}

export function RankOneChip({ month }: { month: string }) {
  return <span className="r1-chip"><Crown size={13} aria-hidden /> Rank 1 · {month}</span>
}

/**
 * Gold dust over the whole page, rising from the bottom of the screen wherever it is scrolled (the user, 10 Nov:
 * "when scrolling down it is not there"); the soft gold cloud stays at the top, behind the greeting.
 */
export function RankOneDust() {
  const dust = useMemo(() => Array.from({ length: 34 }, (_, i) => {
    const r = (n: number) => { const x = Math.sin(i * 9301 + n * 49297) * 233280; return x - Math.floor(x) }
    return { left: 2 + r(1) * 96, dx: r(2) * 50 - 25, dur: 9 + r(3) * 7, delay: -r(4) * 16, size: 2 + r(5) * 2 }
  }), [])
  return (
    <>
      <div className="r1-stage" aria-hidden><div className="r1-cloud" /></div>
      <div className="r1-sky" aria-hidden>
        {dust.map((d, i) => (
          <span key={i} className="r1-dust" style={{ left: `${d.left}%`, width: d.size, height: d.size, animationDuration: `${d.dur}s`, animationDelay: `${d.delay}s`, ['--dx' as string]: `${d.dx}px` }} />
        ))}
      </div>
    </>
  )
}
