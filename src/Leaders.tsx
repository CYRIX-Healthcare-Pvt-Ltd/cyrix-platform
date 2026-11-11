import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Crown, Trophy, X } from 'lucide-react'
import { supabase } from './lib/supabase'
import { useBackCloses } from './Digest'
import { takeR1 } from './lib/r1Link'

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
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const fullMonth = (iso: string) => `${FULL[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

const DUST = Array.from({ length: 22 }, (_, i) => {
  const r = (n: number) => { const x = Math.sin(i * 7919 + n * 104729) * 233280; return x - Math.floor(x) }
  return { left: 3 + r(1) * 94, dx: r(2) * 24 - 12, dur: 10 + r(3) * 8, delay: -r(4) * 18, size: 2 + r(5) * 2 }
})

/* A finer crown for the pop-up's head (the user, 11 Nov: "make the crown more elegant"): four slender points tipped
   with pearls, a jewelled band, polished gold. */
// The user, 11 Nov: "make old crown, let me see" — the plain crown back for a look; false brings the jewelled one back.
const OLD_CROWN = true

function RoyalCrown() {
  return (
    <svg viewBox="0 0 140 104" width="104" height="77" className="leaders-crown-art">
      <defs>
        <radialGradient id="lzGlow" cx="0.5" cy="0.55" r="0.5">
          <stop offset="0" stopColor="#fffbe6" stopOpacity="0.85" /><stop offset="1" stopColor="#fffbe6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lzGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fffdf2" /><stop offset="0.35" stopColor="#ffe588" /><stop offset="0.7" stopColor="#f0b62a" /><stop offset="1" stopColor="#b97c06" />
        </linearGradient>
        <linearGradient id="lzBand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6cf" /><stop offset="0.5" stopColor="#f2c23e" /><stop offset="1" stopColor="#9c6604" />
        </linearGradient>
        <linearGradient id="lzVelvet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d4183a" /><stop offset="1" stopColor="#6e0717" />
        </linearGradient>
        <radialGradient id="lzRuby" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ff8a9c" /><stop offset="0.45" stopColor="#d0102e" /><stop offset="1" stopColor="#5e0414" />
        </radialGradient>
        <radialGradient id="lzSapphire" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#9fd0ff" /><stop offset="0.5" stopColor="#1f5fbf" /><stop offset="1" stopColor="#0b2559" />
        </radialGradient>
        <radialGradient id="lzPearl" cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#ffffff" /><stop offset="0.7" stopColor="#f6efdd" /><stop offset="1" stopColor="#cdbb92" />
        </radialGradient>
      </defs>
      <ellipse className="lz-crown-glow" cx="70" cy="56" rx="68" ry="46" fill="url(#lzGlow)" />
      {/* velvet cap behind the points */}
      <path d="M30 70 Q30 30 70 26 Q110 30 110 70 Z" fill="url(#lzVelvet)" />
      {/* the frame: five points */}
      <path d="M20 78 L12 30 L40 54 L52 18 L70 46 L88 18 L100 54 L128 30 L120 78 Z" fill="url(#lzGold)" stroke="#7d5004" strokeWidth="1.3" strokeLinejoin="round" />
      {/* polish down each point */}
      <path d="M15 34 L21 74 M53 23 L47 50 M87 23 L93 50 M125 34 L119 74" stroke="#fffbe8" strokeWidth="1.4" strokeLinecap="round" opacity="0.75" />
      <path d="M26 68 Q70 58 114 68" fill="none" stroke="#fff8dc" strokeWidth="1" opacity="0.9" />
      {/* the band */}
      <rect x="16" y="78" width="108" height="16" rx="4" fill="url(#lzBand)" stroke="#7d5004" strokeWidth="1.3" />
      <path d="M20 81.5 H120" stroke="#fffbe8" strokeWidth="1" opacity="0.8" />
      {[24, 34, 106, 116].map(x => <circle key={x} cx={x} cy="86" r="1.8" fill="url(#lzPearl)" />)}
      <ellipse cx="50" cy="86" rx="5" ry="4.2" fill="url(#lzSapphire)" stroke="#7d5004" strokeWidth="0.8" />
      <ellipse cx="90" cy="86" rx="5" ry="4.2" fill="url(#lzSapphire)" stroke="#7d5004" strokeWidth="0.8" />
      <path d="M70 79 L78 86 L70 93 L62 86 Z" fill="url(#lzRuby)" stroke="#7d5004" strokeWidth="0.8" />
      {/* the big ruby on the frame */}
      <path d="M70 52 L78 61 L70 71 L62 61 Z" fill="url(#lzRuby)" stroke="#7d5004" strokeWidth="1" />
      <path d="M66 58 L70 54 L72 57" stroke="#ffd5dc" strokeWidth="1" fill="none" strokeLinecap="round" />
      <circle cx="36" cy="66" r="3" fill="url(#lzSapphire)" stroke="#7d5004" strokeWidth="0.7" />
      <circle cx="104" cy="66" r="3" fill="url(#lzSapphire)" stroke="#7d5004" strokeWidth="0.7" />
      {/* Light catching the gems, left to right, every few seconds (the user, 11 Nov). */}
      <g className="lz-gem-flash" fill="#fff">
        <circle cx="36" cy="66" r="3" style={{ animationDelay: '1.4s' }} />
        <ellipse cx="50" cy="86" rx="5" ry="4.2" style={{ animationDelay: '1.52s' }} />
        <path d="M70 52 L78 61 L70 71 L62 61 Z" style={{ animationDelay: '1.64s' }} />
        <path d="M70 79 L78 86 L70 93 L62 86 Z" style={{ animationDelay: '1.7s' }} />
        <ellipse cx="90" cy="86" rx="5" ry="4.2" style={{ animationDelay: '1.82s' }} />
        <circle cx="104" cy="66" r="3" style={{ animationDelay: '1.94s' }} />
      </g>
      {/* pearls on the tips */}
      <circle cx="12" cy="27" r="5" fill="url(#lzPearl)" stroke="#a87708" strokeWidth="0.8" />
      <circle cx="52" cy="14" r="5.4" fill="url(#lzPearl)" stroke="#a87708" strokeWidth="0.8" />
      <circle cx="88" cy="14" r="5.4" fill="url(#lzPearl)" stroke="#a87708" strokeWidth="0.8" />
      <circle cx="128" cy="27" r="5" fill="url(#lzPearl)" stroke="#a87708" strokeWidth="0.8" />
    </svg>
  )
}

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
  const [open, setOpen] = useState(() => takeR1('list'))
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
  // Mine first (the user, 11 Nov): my own team's Rank 1 (or me) and, for a manager, the Rank 1 of the team I lead;
  // everybody else stays by manager, A to Z.
  const [mine, setMine] = useState<{ me: string; mgr: string | null } | null>(null)
  useEffect(() => {
    if (!open || mine) return
    let alive = true
    ;(async () => {
      const { data: auth } = await supabase.auth.getUser()
      const { data: me } = await supabase.from('employees').select('ecode, reporting_manager_id').eq('auth_user_id', auth.user?.id ?? '').maybeSingle()
      if (!alive || !me) return
      const { data: m } = me.reporting_manager_id
        ? await supabase.from('employees').select('ecode').eq('id', me.reporting_manager_id).maybeSingle()
        : { data: null }
      if (alive) setMine({ me: String(me.ecode).toUpperCase(), mgr: m?.ecode ? String(m.ecode).toUpperCase() : null })
    })()
    return () => { alive = false }
  }, [open, mine])
  const tagOf = (x: One) => {
    if (!mine) return null
    if (x.ecode.toUpperCase() === mine.me) return 'You'
    if ((mine.mgr && x.manager_ecode.toUpperCase() === mine.mgr) || x.manager_ecode.toUpperCase() === mine.me) return 'Your team'
    return null
  }
  const listed = useMemo(() => {
    const top = ones.filter(x => tagOf(x)); const rest = ones.filter(x => !tagOf(x))
    // The team I belong to before the team I lead.
    top.sort((a, b) => Number(a.manager_ecode.toUpperCase() === mine?.me) - Number(b.manager_ecode.toUpperCase() === mine?.me))
    return [...top, ...rest]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ones, mine])
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
              {/* Royal and premium (the user, 11 Nov): no team count; the month in full between gold marks, the title
                  set like an engraving, a filled gold crown with glints, a sheen crossing the gold, a gilt edge below. */}
              <span className="leaders-art" aria-hidden>
                {OLD_CROWN ? <Crown size={84} strokeWidth={1.6} className="leaders-crown-old" /> : <RoyalCrown />}
                {/* The plain crown goes without the glints (the user, 11 Nov: "the old sparkles are there"). */}
                {!OLD_CROWN && <><i className="leaders-glint g1" /><i className="leaders-glint g2" /><i className="leaders-glint g3" /></>}
              </span>
              <span className="leaders-eyebrow"><i aria-hidden />{fullMonth(ones[0].period_month)}<i aria-hidden /></span>
              <h2>Rank 1<small>s</small></h2>
              <button type="button" className="leaders-close" onClick={() => setOpen(false)} title="Close"><X size={18} /><span className="sr">Close</span></button>
            </div>
            <ul className="leaders-list">
              {listed.map(x => (
                // The whole row opens the large photo, not only the round (the user, 11 Nov: easier with a thumb).
                <li key={x.manager_ecode + x.ecode} data-mine={tagOf(x) ? 'true' : undefined} role="button" tabIndex={0}
                  aria-label={`${x.full_name}, ${x.manager_name}'s team`} onClick={() => setFace(x)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFace(x) } }}>
                  <span className="leaders-face" aria-hidden>
                    {x.avatar ? <img src={x.avatar} alt="" loading="lazy" draggable={false} /> : <Crown size={18} />}
                  </span>
                  <span className="leaders-text">
                    <span className="leaders-mgr">{x.manager_name}&rsquo;s team{x.function_name && ` · ${x.function_name}`}</span>
                    <span className="leaders-who"><b className="r1-name leaders-gold">{x.full_name}</b> <span>{x.ecode}{x.designation ? ` · ${x.designation}` : ''}</span></span>
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
                  <b className="leaders-zoom-name r1-name" key={face.ecode}>{face.full_name}</b>
                  <span className="leaders-zoom-role">{face.ecode}{face.designation ? ` · ${face.designation}` : ''}</span>
                  {/* When it takes two lines, the manager's name starts the second (the user, 11 Nov). */}
                  <span className="leaders-zoom-rank"><span className="lz-rank-of">{month} Rank 1 in</span><span className="lz-rank-team">{face.manager_name}&rsquo;s team</span></span>
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
