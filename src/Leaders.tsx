import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Crown, Trophy, X } from 'lucide-react'
import { supabase } from './lib/supabase'
import { useBackCloses } from './Digest'

/*
  Every team's Rank 1 for the month being assessed, on the portal home for everybody (the user, 10 Nov: "better add
  something like this, in golden, this height, on click a pop up shows all in managers alphabetical order"). A gold bar
  the height of the Digest bar, beside it on one row ("2 rows in bad, but need both"), naming the Rank 1s one after
  another; a press opens the whole list by manager, A to Z. The pop-up keeps its gold top and its close button while
  the list scrolls, fills a phone's screen, and has no search ("no search needed"). Names, designation, function and the manager
  only, no scores (kpi_rank_ones, KPI 0276).
*/
interface One { manager_name: string; manager_ecode: string; full_name: string; ecode: string; designation: string | null; function_name: string | null; period_month: string; avatar?: string | null }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const label = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`
const first = (name: string) => name.split(/\s+/)[0]

const DUST = Array.from({ length: 22 }, (_, i) => {
  const r = (n: number) => { const x = Math.sin(i * 7919 + n * 104729) * 233280; return x - Math.floor(x) }
  return { left: 3 + r(1) * 94, dx: r(2) * 24 - 12, dur: 10 + r(3) * 8, delay: -r(4) * 18, size: 2 + r(5) * 2 }
})

const SPARKS = Array.from({ length: 12 }, (_, k) => k)

export function useRankOnes(on: boolean) {
  const [ones, setOnes] = useState<One[] | null>(null)
  useEffect(() => {
    if (!on) return
    void supabase.rpc('kpi_rank_ones').then(({ data }) => setOnes((data ?? []) as One[]), () => setOnes([]))
  }, [on])
  return ones
}

export default function Leaders({ ones }: { ones: One[] }) {
  const [i, setI] = useState(0)
  const [open, setOpen] = useState(false)
  // One Rank 1's photo, large; a press anywhere closes it (the user, 11 Nov: "just a click again will close it").
  const [face, setFace] = useState<One | null>(null)
  useBackCloses(open, () => { if (face) setFace(null); else setOpen(false) })
  // One name after another, in a fresh order each visit.
  const order = useMemo(() => ones.map((_, k) => k).sort(() => Math.random() - 0.5), [ones])
  useEffect(() => {
    if (ones.length < 2) return
    const t = window.setInterval(() => setI(n => (n + 1) % ones.length), 4000)
    return () => window.clearInterval(t)
  }, [ones])
  useEffect(() => {
    if (!open) return
    const html = document.documentElement, body = document.body
    const was = [html.style.overflow, body.style.overflow]
    html.style.overflow = 'hidden'; body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFace(f => { if (!f) setOpen(false); return null }) } }
    document.addEventListener('keydown', esc)
    return () => { html.style.overflow = was[0]; body.style.overflow = was[1]; document.removeEventListener('keydown', esc) }
  }, [open])
  const month = label(ones[0].period_month)
  const o = ones[order[i % order.length]]
  return (
    <>
      <button type="button" className="leaders-bar" onClick={() => setOpen(true)} aria-label={`${month} Rank 1s`}>
        <span className="leaders-tag"><Trophy size={15} /> <span className="leaders-tag-words">{month} Rank 1s</span></span>
        <span key={o.ecode} className="leaders-line"><Crown size={14} /> {o.full_name} <span className="leaders-team">· {first(o.manager_name)}&rsquo;s team</span></span>
        <ChevronRight size={16} className="leaders-go" />
      </button>
      {open && createPortal(
        <div className="leaders-shade" onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="leaders-panel" role="dialog" aria-modal="true" aria-label={`${month} Rank 1s`}>
            {/* Gold dust rising through the list, for everybody who opens it (the user, 11 Nov: "it is rank list so"). */}
            <div className="leaders-sky" aria-hidden>
              {DUST.map((d, k) => (
                <span key={k} style={{ left: `${d.left}%`, width: d.size, height: d.size, animationDuration: `${d.dur}s`, animationDelay: `${d.delay}s`, ['--dx' as string]: `${d.dx}px` }} />
              ))}
            </div>
            <div className="leaders-head">
              <span className="leaders-art" aria-hidden><Crown size={88} /></span>
              <span className="leaders-count"><Crown size={14} /> {ones.length} teams</span>
              <h2>{month} Rank 1s</h2>
              <button type="button" className="leaders-close" onClick={() => setOpen(false)} title="Close"><X size={18} /><span className="sr">Close</span></button>
            </div>
            <ul className="leaders-list">
              {ones.map(x => (
                <li key={x.manager_ecode + x.ecode}>
                  <button type="button" className="leaders-face" onClick={() => setFace(x)} aria-label={`${x.full_name}'s photo`}>
                    {x.avatar ? <img src={x.avatar} alt="" loading="lazy" draggable={false} /> : <Crown size={18} />}
                  </button>
                  <span className="leaders-text">
                    <span className="leaders-mgr">{x.manager_name}&rsquo;s team{x.function_name && ` · ${x.function_name}`}</span>
                    <span className="leaders-who"><b>{x.full_name}</b> <span>{x.ecode}{x.designation ? ` · ${x.designation}` : ''}</span></span>
                  </span>
                </li>
              ))}
            </ul>
            {face && (
              <div className="leaders-zoom" onClick={() => setFace(null)} role="dialog" aria-modal="true" aria-label={face.full_name}>
                <div className="leaders-zoom-card">
                  {/* Royal arrival (the user, 11 Nov): the card rises, a gold ring turns round the photo, a crown drops on it and gold sparks burst once. */}
                  <span className="leaders-zoom-halo">
                    <span className="leaders-zoom-ring" aria-hidden />
                    <span className="leaders-zoom-face">{face.avatar ? <img src={face.avatar} alt="" draggable={false} /> : <Crown size={54} />}</span>
                    <span className="leaders-zoom-crown" aria-hidden><Crown size={34} strokeWidth={2.2} /></span>
                    <span className="leaders-zoom-burst" aria-hidden>{SPARKS.map(k => <i key={k} style={{ ['--a' as string]: `${k * 30}deg`, ['--d' as string]: `${(k % 3) * 40}ms` }} />)}</span>
                  </span>
                  <b className="leaders-zoom-name" key={face.ecode}>{face.full_name}</b>
                  <span className="leaders-zoom-role">{face.ecode}{face.designation ? ` · ${face.designation}` : ''}</span>
                  <span className="leaders-zoom-rank">{month} Rank 1 in {face.manager_name}&rsquo;s team</span>
                  {face.function_name && <span className="leaders-zoom-fn">{face.function_name}</span>}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
