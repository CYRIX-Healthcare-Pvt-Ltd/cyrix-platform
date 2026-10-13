import Md from './Md'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Heart, MessageCircle, Megaphone, Newspaper, Send, Trash2, Video, X, MapPin, Clock, ChevronRight, BarChart3, Check,
  TriangleAlert, Pin, Briefcase, CalendarClock, ClipboardList, Pencil, PlayCircle, Play,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import './digest.css'

/**
 * Cyrix Digest (KPI 0163–0167; the user, 10 Oct): company news, meetings
 * and polls, posted by HR, IT and Marketing, under the module tiles — "very
 * attractive and colourful", "always filled". Everybody sees every post;
 * news can be liked; anything can be commented on; Join on a meeting is
 * counted, then the meeting opens — Teams, Google Meet, Zoom, whatever the
 * link is; a poll takes one answer or several. Likes, comments and votes
 * notify nobody. What the home page shows counts as seen, and tapping in
 * counts as opened (0166).
 */
export interface Post {
  id: string; kind: Kind; title: string; body: string; image_url: string | null; color: Hue
  meet_at: string | null; meet_minutes: number | null; meet_link: string | null; meet_place: string | null
  posted_as: 'hr' | 'it' | 'mkt'; author: string | null; created_at: string
  likes: number; liked: boolean; comments: number
  /** A vacancy (0170): where, apply by, and how to apply. */
  vac_location: string | null; apply_by: string | null; apply_link: string | null
  /** A meeting has a link, even while it is kept back until 15 minutes before (KPI 0182). */
  has_link?: boolean
  /** Minutes before the start that Join opens, and a Video post's YouTube id (KPI 0185). */
  join_early?: number; video_id?: string | null
  /** A draft sent to this person as a test (KPI 0187): only they see it, and Join works at once. */
  is_test?: boolean
}
/** Every kind of post (0170; the user: "announcement, alerts, notice, vacancy"). */
type Kind = 'news' | 'announcement' | 'alert' | 'notice' | 'vacancy' | 'meeting' | 'poll' | 'form' | 'video'
const KIND_WORD: Record<Kind, string> = {
  news: 'News', announcement: 'Announcement', alert: 'Alert', notice: 'Notice', vacancy: 'Vacancy', meeting: 'Meeting', poll: 'Poll', form: 'Form', video: 'Video',
}
/** One of the named colours, or any colour as #rrggbb (0168). */
type Hue = string
interface Comment { id: string; author: string; ecode: string; body: string; created_at: string; mine: boolean }
interface Option { id: string; label: string; votes: number; mine: boolean; closes_at: string | null; multi: boolean; voters: number }

export const HUES: Record<string, { from: string; to: string; ink: string; soft: string }> = {
  red:    { from: '#f43f5e', to: '#ce2434', ink: '#e11d48', soft: 'rgb(244 63 94 / 0.14)' },
  orange: { from: '#fb923c', to: '#ea580c', ink: '#ea580c', soft: 'rgb(251 146 60 / 0.16)' },
  amber:  { from: '#fbbf24', to: '#d97706', ink: '#d97706', soft: 'rgb(251 191 36 / 0.18)' },
  green:  { from: '#4ade80', to: '#16a34a', ink: '#16a34a', soft: 'rgb(74 222 128 / 0.16)' },
  teal:   { from: '#2dd4bf', to: '#0d9488', ink: '#0d9488', soft: 'rgb(45 212 191 / 0.16)' },
  blue:   { from: '#60a5fa', to: '#2563eb', ink: '#2563eb', soft: 'rgb(96 165 250 / 0.16)' },
  violet: { from: '#a78bfa', to: '#7c3aed', ink: '#7c3aed', soft: 'rgb(167 139 250 / 0.16)' },
  pink:   { from: '#f472b6', to: '#db2777', ink: '#db2777', soft: 'rgb(244 114 182 / 0.16)' },
}
/** A custom colour gets the same treatment: lighter at the top-left, its own tint behind. */
const hue = (h: Hue) => {
  if (HUES[h]) return HUES[h]
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h)
  if (!m) return HUES.violet
  const [r, g, b] = m.slice(1).map(x => parseInt(x, 16))
  const light = (v: number) => Math.round(v + (255 - v) * 0.35)
  return { from: `rgb(${light(r)} ${light(g)} ${light(b)})`, to: h, ink: h, soft: `rgb(${r} ${g} ${b} / 0.15)` }
}
const grad = (h: Hue) => `linear-gradient(135deg, ${hue(h).from}, ${hue(h).to})`
const tint = (h: Hue) => ({ ['--hue' as string]: hue(h).ink, ['--soft' as string]: hue(h).soft, ['--grad' as string]: grad(h) }) as CSSProperties
const ytThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
const cover = (p: Post) => (p.image_url ? `center/cover no-repeat url(${p.image_url})`
  : p.video_id ? `center/cover no-repeat url(${ytThumb(p.video_id)})` : grad(p.color))

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return m <= 1 ? 'just now' : `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  return d < 30 ? `${d} day${d === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
/** Join opens this long before a meeting starts (the user, 12 Oct: "15 mins before start only enable it"). */
const JOIN_EARLY_MS = 15 * 60_000

/** The clock, on the half minute, so a Join button opens on time without a reload. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t) }, [ms])
  return now
}

/** Join, open from 15 minutes before the start until the end; before that it says when it opens. */
function JoinButton({ p, onJoin, className }: { p: Post; onJoin: (p: Post) => void; className: string }) {
  const now = useNow()
  const start = new Date(p.meet_at!).getTime()
  const opens = start - (p.join_early != null ? p.join_early * 60_000 : JOIN_EARLY_MS)
  const end = start + (p.meet_minutes ?? 60) * 60_000
  if (now >= end) return null
  if (p.is_test) {
    return p.meet_link
      ? <button type="button" className={className} onClick={() => onJoin(p)}><Video size={16} /> Join meeting (test)</button>
      : <button type="button" className={className} disabled><Clock size={16} /> Meeting link will be shared soon</button>
  }
  // Announced before its link (KPI 0180): everybody is told when it comes. Once set, the link
  // itself only arrives 15 minutes before (0182), so "has one" is what decides this.
  if (!p.meet_link && !(p.has_link ?? false)) return <button type="button" className={className} disabled><Clock size={16} /> Meeting link will be shared soon</button>
  if (now < opens) {
    const at = new Date(opens)
    const sameDay = at.toDateString() === new Date(now).toDateString()
    const label = at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()
      + (sameDay ? '' : ', ' + at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))
    return <button type="button" className={className} disabled><Clock size={16} /> Join opens at {label}</button>
  }
  return <button type="button" className={className} onClick={() => onJoin(p)}><Video size={16} /> Join meeting</button>
}

const when = (p: Post) => {
  const s = new Date(p.meet_at!)
  const e = new Date(s.getTime() + (p.meet_minutes ?? 60) * 60000)
  const t = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()
  return `${s.toLocaleDateString('en-GB', { weekday: 'short' })} · ${t(s)} – ${t(e)}`
}
const desk = (p: Post) => (p.posted_as === 'it' ? 'IT' : p.posted_as === 'mkt' ? 'Marketing' : 'HR')
/** Where the meeting is: what was typed, else read off the link (the user: "what if it is Google Meet"). */
const where = (p: Post) => {
  if (p.meet_place) return p.meet_place
  const l = (p.meet_link ?? '').toLowerCase()
  return l.includes('meet.google') ? 'Google Meet' : l.includes('teams.') ? 'Microsoft Teams' : l.includes('zoom.') ? 'Zoom' : null
}
const KindIcon = ({ p, size = 18 }: { p: Post; size?: number }) => {
  const I = { news: Newspaper, announcement: Megaphone, alert: TriangleAlert, notice: Pin, vacancy: Briefcase, meeting: Video, poll: BarChart3, form: ClipboardList, video: PlayCircle }[p.kind] ?? Newspaper
  return <I size={size} />
}
/** How to apply: an email address becomes an email; anything else is a link. */
const applyHref = (l: string) => (/^mailto:/i.test(l) ? l : /@/.test(l) && !/^https?:/i.test(l) ? `mailto:${l}` : l)
const shortDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** What the home page shows: the next meeting, then the newest, enough to fill the rows. */
function pick(posts: Post[]) {
  const now = Date.now()
  const next = posts
    .filter(p => p.kind === 'meeting' && new Date(p.meet_at!).getTime() + (p.meet_minutes ?? 60) * 60000 > now)
    .sort((a, b) => a.meet_at!.localeCompare(b.meet_at!))[0]
  // An alert from the last week goes first, then the newest.
  const week = now - 7 * 864e5
  const isAlert = (p: Post) => p.kind === 'alert' && new Date(p.created_at).getTime() > week
  const others = posts.filter(p => p.kind !== 'meeting')
  const rest = [...others.filter(isAlert), ...others.filter(p => !isAlert(p))].slice(0, next ? 4 : 6)
  return { next, rest }
}

const LAST_LOOK = 'cyrix.digest.lastLook'
const lastLook = () => { try { return Number(localStorage.getItem(LAST_LOOK) ?? 0) } catch { return 0 } }
const looked = () => { try { localStorage.setItem(LAST_LOOK, String(Date.now())) } catch { /* private window */ } }

/**
 * Under the greeting, so the Digest is found (the user, 10 Oct: "on login,
 * how will they know the digest is there?"): the latest headlines in turn,
 * how many are new since this browser last looked, and a click that
 * scrolls down to it.
 */
export function DigestTeaser() {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [i, setI] = useState(0)
  const [since] = useState(lastLook)
  useEffect(() => { void supabase.rpc('digest_feed', { p_limit: 8 }).then(({ data }) => setPosts((data ?? []) as Post[])) }, [])
  useEffect(() => {
    if (!posts || posts.length < 2) return
    const t = window.setInterval(() => setI(n => (n + 1) % Math.min(posts.length, 5)), 4000)
    return () => window.clearInterval(t)
  }, [posts])
  if (!posts?.length) return null
  const fresh = posts.filter(p => new Date(p.created_at).getTime() > since).length
  const p = posts[i % posts.length]
  const line = p.kind === 'meeting'
    ? `${p.title} · ${new Date(p.meet_at!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
    : p.title
  const go = () => {
    looked()
    document.getElementById('digest-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <button type="button" className="digest-teaser" onClick={go}>
      <span className="digest-teaser-tag"><Newspaper size={15} /> Cyrix Digest</span>
      {fresh > 0 && <span className="digest-teaser-new">{fresh} new</span>}
      <span key={p.id} className="digest-teaser-line"><KindIcon p={p} size={14} /> {line}</span>
      <ChevronRight size={16} className="digest-teaser-go" />
    </button>
  )
}

export default function Digest() {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [open, setOpen] = useState<Post | null>(null)
  const [all, setAll] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('digest_feed', { p_limit: 30 })
    const rows = (data ?? []) as Post[]
    setPosts(rows)
    // Looked at once it has been on screen for a moment.
    window.setTimeout(() => {
      const el = document.getElementById('digest-title')
      if (!el) return
      const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { looked(); io.disconnect() } })
      io.observe(el)
    }, 1500)
    const { next, rest } = pick(rows)
    const shown = [...(next ? [next] : []), ...rest]
    // .then(): a Supabase call is only sent once something asks for its answer.
    if (shown.length) void supabase.rpc('digest_seen', { p_ids: shown.map(r => r.id) }).then(() => {}, () => {})
  }, [])
  useEffect(() => { void load() }, [load])

  if (!posts?.length) return null
  const { next, rest } = pick(posts)

  // Always filled (the user, 10 Oct): the last card stretches over what its row has left.
  // 3 columns from 960px (the meeting takes 2), 2 from 720px (the meeting takes 1).
  const used3 = (next ? 2 : 0) + rest.length
  const used2 = (next ? 1 : 0) + rest.length
  const fill3 = used3 % 3 ? 3 - (used3 % 3) + 1 : 1
  const fill2 = used2 % 2 ? 2 : 1
  const lastStyle = { ['--fill3' as string]: fill3, ['--fill2' as string]: fill2 } as CSSProperties

  const like = async (p: Post) => {
    const flip = (x: Post) => (x.id === p.id ? { ...x, liked: !x.liked, likes: x.likes + (x.liked ? -1 : 1) } : x)
    setPosts(ps => ps?.map(flip) ?? ps)
    setOpen(o => (o && o.id === p.id ? flip(o) : o))
    const { error } = await supabase.rpc('digest_toggle_like', { p_id: p.id })
    if (error) void load()
  }
  const join = async (p: Post) => {
    // Opened now, before the round trip, so the browser does not take it for a pop-up.
    const w = window.open('', '_blank')
    const { data } = await supabase.rpc('digest_join', { p_id: p.id })
    const link = (data as string | null) ?? p.meet_link
    if (link) { if (w) w.location.href = link; else window.location.href = link }
    else w?.close()
  }

  const cards = [
    ...(next ? [<MeetingCard key={next.id} p={next} onJoin={join} onOpen={setOpen} />] : []),
    ...rest.map(p => (p.kind === 'poll'
      ? <PollCard key={p.id} p={p} onOpen={setOpen} />
      : p.kind === 'form'
      ? <FormCard key={p.id} p={p} onOpen={setOpen} />
      : <NewsCard key={p.id} p={p} onLike={like} onOpen={setOpen} />)),
  ]

  return (
    <section className="digest" aria-labelledby="digest-title">
      <div className="digest-head">
        <h2 id="digest-title"><span className="digest-dots" aria-hidden><i /><i /><i /></span>Cyrix Digest</h2>
        <button type="button" className="digest-all" onClick={() => setAll(true)}>See all <ChevronRight size={15} /></button>
      </div>

      <div className="digest-grid">
        {cards.map((c, i) => (i === cards.length - 1 && !(next && cards.length === 1)
          ? <div key={c.key} className="digest-last" style={lastStyle}>{c}</div>
          : c))}
      </div>

      {all && (
        <Sheet onClose={() => setAll(false)} label="Cyrix Digest">
          <div className="digest-sheet-hero" style={{ background: 'linear-gradient(135deg, #f43f5e, #7c3aed 55%, #2563eb)' }}>
            <span className="digest-sheet-art" aria-hidden><Newspaper size={120} /></span>
            <span className="digest-sheet-kind"><Newspaper size={14} /> All posts</span>
            <h2>Cyrix Digest</h2>
            <p>News, meetings and polls from HR, IT and Marketing.</p>
          </div>
          <div className="digest-list">
            {posts.map(p => (
              <button key={p.id} type="button" className="digest-row" style={tint(p.color)} onClick={() => setOpen(p)}>
                <span className="digest-row-cover" style={{ background: cover(p) }}>{!p.image_url && <KindIcon p={p} />}</span>
                <span className="digest-row-text">
                  <strong>{p.title}</strong>
                  <span>{p.kind === 'meeting'
                    ? `Meeting · ${new Date(p.meet_at!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                    : `${KIND_WORD[p.kind]} · ${desk(p)} · ${ago(p.created_at)}`}</span>
                </span>
                {p.kind !== 'meeting' && p.kind !== 'poll' && p.kind !== 'form' && <span className="digest-row-n"><Heart size={13} /> {p.likes}</span>}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {open && <PostSheet p={open} onClose={() => { setOpen(null); void load() }} onLike={like} onJoin={join} />}
    </section>
  )
}

function MeetingCard({ p, onJoin, onOpen }: { p: Post; onJoin: (p: Post) => void; onOpen: (p: Post) => void }) {
  const d = new Date(p.meet_at!)
  const place = where(p)
  return (
    // The whole card opens the post, the words under the title too (the user, 12 Oct); Join keeps its own job.
    <article className="digest-meeting" style={{ background: grad(p.color) }}
      onClick={e => { if (!(e.target as HTMLElement).closest('button, a')) onOpen(p) }}>
      <div className="digest-meeting-top">
        <span className="digest-badge"><Megaphone size={13} /> Upcoming meeting</span>
        {p.is_test && <span className="digest-test-chip">Test · only you can see this</span>}
        <span className="digest-by">{desk(p)}</span>
      </div>
      <button type="button" className="digest-meeting-main" onClick={() => onOpen(p)}>
        <span className="digest-date">
          <small>{d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}</small>
          <b>{d.getDate()}</b>
        </span>
        <span>
          <strong>{p.title}</strong>
          <span className="digest-when"><Clock size={13} /> {when(p)}</span>
          {place && <span className="digest-when"><MapPin size={13} /> {place}</span>}
        </span>
      </button>
      {p.body && <Md className="digest-meeting-body" text={p.body} />}
      <div className="digest-meeting-actions">
        <JoinButton p={p} onJoin={onJoin} className="digest-join" />
      </div>
    </article>
  )
}

function NewsCard({ p, onLike, onOpen }: { p: Post; onLike: (p: Post) => void; onOpen: (p: Post) => void }) {
  return (
    <article className={p.kind === 'alert' ? 'digest-news alert' : 'digest-news'} style={tint(p.color)}>
      <button type="button" className="digest-cover" onClick={() => onOpen(p)} style={{ background: cover(p) }} aria-label={p.title}>
        {!p.image_url && !p.video_id && <span className="digest-cover-art" aria-hidden><KindIcon p={p} size={38} /><i /><i /><i /></span>}
        {p.video_id && <span className="digest-play" aria-hidden><Play size={26} fill="currentColor" /></span>}
        <span className="digest-chip">{desk(p)}</span>
        {p.is_test && <span className="digest-test-chip">Test · only you can see this</span>}
        {p.kind !== 'news' && <span className="digest-kind"><KindIcon p={p} size={13} /> {KIND_WORD[p.kind]}</span>}
      </button>
      <div className="digest-news-body">
        <button type="button" className="digest-news-title" onClick={() => onOpen(p)}>{p.title}</button>
        {p.kind === 'vacancy' && (p.vac_location || p.apply_by) && (
          <p className="digest-vac">
            {p.vac_location && <span><MapPin size={13} /> {p.vac_location}</span>}
            {p.apply_by && <span><CalendarClock size={13} /> Apply by {shortDate(p.apply_by)}</span>}
          </p>
        )}
        {p.body && <Md text={p.body} />}
        <div className="digest-news-foot">
          <button type="button" className={p.liked ? 'digest-like on' : 'digest-like'} onClick={() => onLike(p)} aria-pressed={p.liked}>
            <Heart size={16} fill={p.liked ? 'currentColor' : 'none'} /> {p.likes}
          </button>
          <button type="button" className="digest-like" onClick={() => onOpen(p)}><MessageCircle size={16} /> {p.comments}</button>
          <span className="digest-ago">{ago(p.created_at)}</span>
        </div>
      </div>
    </article>
  )
}

/** The id a draft carries in the preview (KPI's Digest page shows it before it is posted). */
const PREVIEW_ID = 'preview'
let previewOptions: Option[] = []
let previewForm: FormQ[] = []

/** The question's options, and this person's answer. */
function usePoll(id: string) {
  const [opts, setOpts] = useState<Option[] | null>(null)
  const load = useCallback(async () => {
    if (id === PREVIEW_ID) { setOpts(previewOptions); return }
    const { data } = await supabase.rpc('digest_poll', { p_id: id })
    setOpts((data ?? []) as Option[])
  }, [id])
  useEffect(() => { void load() }, [load])
  return { opts, load }
}

/** Choose and vote; once voted, the results as bars, and a way to change the answer. */
function PollBody({ p, compact }: { p: Post; compact?: boolean }) {
  const { opts, load } = usePoll(p.id)
  const [chosen, setChosen] = useState<string[]>([])
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!opts) return <div className="digest-poll-skel" />
  const multi = !!opts[0]?.multi
  const voted = opts.some(o => o.mine)
  const closed = !!opts[0]?.closes_at && new Date(opts[0].closes_at).getTime() < Date.now()
  const total = opts[0]?.voters ?? 0
  const showResults = (voted && !changing) || closed
  const toggle = (id: string) => setChosen(s => (multi ? (s.includes(id) ? s.filter(x => x !== id) : [...s, id]) : [id]))
  const vote = async () => {
    if (p.id === PREVIEW_ID) return
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('digest_vote', { p_id: p.id, p_options: chosen })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setChanging(false); setChosen([]); void load()
  }
  return (
    <div className={compact ? 'digest-poll compact' : 'digest-poll'}>
      {showResults ? (
        <>
          {opts.map(o => {
            const pct = total ? Math.round((o.votes / total) * 100) : 0
            return (
              <div key={o.id} className={o.mine ? 'digest-result mine' : 'digest-result'}>
                <span className="digest-result-bar" style={{ width: `${pct}%` }} />
                <span className="digest-result-label">{o.mine && <Check size={14} />} {o.label}</span>
                <span className="digest-result-pct">{pct}%</span>
              </div>
            )
          })}
          <p className="digest-poll-meta">
            {total} {total === 1 ? 'vote' : 'votes'}{closed ? ' · closed' : ''}
            {!closed && voted && (
              <button type="button" onClick={() => { setChanging(true); setChosen(opts.filter(o => o.mine).map(o => o.id)) }}>Change answer</button>
            )}
          </p>
        </>
      ) : (
        <>
          {opts.map(o => (
            <button key={o.id} type="button" className={chosen.includes(o.id) ? 'digest-option on' : 'digest-option'} onClick={() => toggle(o.id)}>
              <span className={multi ? 'digest-tick box' : 'digest-tick'}>{chosen.includes(o.id) && <Check size={12} />}</span>
              {o.label}
            </button>
          ))}
          <div className="digest-poll-go">
            <span className="digest-poll-meta">{multi ? 'Choose any' : 'Choose one'}</span>
            <button type="button" className="digest-vote" disabled={!chosen.length || busy} onClick={vote}>Vote</button>
          </div>
          {err && <p className="digest-poll-err">{err}</p>}
        </>
      )}
    </div>
  )
}

function PollCard({ p, onOpen }: { p: Post; onOpen: (p: Post) => void }) {
  return (
    <article className="digest-pollcard" style={tint(p.color)}>
      <div className="digest-pollcard-head" style={{ background: grad(p.color) }}>
        <div className="digest-meeting-top">
          <span className="digest-badge"><BarChart3 size={13} /> Poll</span>
          {p.is_test && <span className="digest-test-chip">Test · only you can see this</span>}
          <span className="digest-by">{desk(p)}</span>
        </div>
        <button type="button" className="digest-pollcard-q" onClick={() => onOpen(p)}>{p.title}</button>
      </div>
      <div className="digest-pollcard-body">
        <PollBody p={p} compact />
        <div className="digest-news-foot">
          <button type="button" className="digest-like" onClick={() => onOpen(p)}><MessageCircle size={16} /> {p.comments}</button>
          <span className="digest-ago">{ago(p.created_at)}</span>
        </div>
      </div>
    </article>
  )
}

/* ---- Forms (KPI 0181; the user, 12 Oct: "can we add forms also?") ---- */
type QType = 'short' | 'long' | 'one' | 'many' | 'yesno' | 'number' | 'date' | 'rating'
interface FormQ {
  id: string; label: string; qtype: QType; options: string[]; required: boolean
  closes_at: string | null; mine: Record<string, string | string[]> | null; sent_at: string | null; answered: number
}
/** The questions, the closing time and this person's answers. */
function useForm(id: string) {
  const [qs, setQs] = useState<FormQ[] | null>(null)
  const load = useCallback(async () => {
    if (id === PREVIEW_ID) { setQs(previewForm); return }
    const { data } = await supabase.rpc('digest_form', { p_id: id })
    setQs((data ?? []) as FormQ[])
  }, [id])
  useEffect(() => { void load() }, [load])
  return { qs, load }
}
const closesOn = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function FormCard({ p, onOpen }: { p: Post; onOpen: (p: Post) => void }) {
  const { qs } = useForm(p.id)
  const closes = qs?.[0]?.closes_at ?? null
  const closed = !!closes && new Date(closes).getTime() < Date.now()
  const sent = !!qs?.[0]?.sent_at
  return (
    <article className="digest-pollcard" style={tint(p.color)}>
      <div className="digest-pollcard-head" style={{ background: grad(p.color) }}>
        <div className="digest-meeting-top">
          <span className="digest-badge"><ClipboardList size={13} /> Form</span>
          {p.is_test && <span className="digest-test-chip">Test · only you can see this</span>}
          <span className="digest-by">{desk(p)}</span>
        </div>
        <button type="button" className="digest-pollcard-q" onClick={() => onOpen(p)}>{p.title}</button>
        {qs && <p className="digest-form-sub">{qs.length} {qs.length === 1 ? 'question' : 'questions'}{closes ? ` · ${closed ? 'closed' : 'closes ' + closesOn(closes)}` : ''}</p>}
      </div>
      <div className="digest-pollcard-body">
        {sent
          ? <p className="digest-form-sent"><Check size={15} /> Sent{!closed && closes ? ` · you can change it until ${closesOn(closes)}` : ''}</p>
          : closed ? <p className="digest-poll-meta">This form has closed.</p>
          : <button type="button" className="digest-vote digest-form-go" onClick={() => onOpen(p)}><Pencil size={15} /> Fill in</button>}
        <div className="digest-news-foot">
          <button type="button" className="digest-like" onClick={() => onOpen(p)}><MessageCircle size={16} /> {p.comments}</button>
          <span className="digest-ago">{ago(p.created_at)}</span>
        </div>
      </div>
    </article>
  )
}

/** Fill it in, send it, and change it until it closes. */
function FormBody({ p }: { p: Post }) {
  const { qs, load } = useForm(p.id)
  const [a, setA] = useState<Record<string, string | string[]>>({})
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (qs?.[0]?.mine) setA(qs[0].mine) }, [qs])
  if (!qs) return <div className="digest-poll-skel" />
  const closes = qs[0]?.closes_at ?? null
  const closed = !!closes && new Date(closes).getTime() < Date.now()
  const sent = !!qs[0]?.sent_at
  const show = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : v) || '—'

  if ((sent && !editing) || closed) {
    return (
      <div className="digest-form">
        {sent
          ? <p className="digest-form-sent"><Check size={15} /> Sent {new Date(qs[0].sent_at!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
          : <p className="digest-poll-meta">This form has closed.</p>}
        {sent && qs.map(q => (
          <div key={q.id} className="digest-form-a"><span>{q.label}</span><strong>{show(qs[0].mine?.[q.id])}</strong></div>
        ))}
        {sent && !closed && <p className="digest-poll-meta"><button type="button" onClick={() => setEditing(true)}>Change answers</button>{closes ? ` · until ${closesOn(closes)}` : ''}</p>}
      </div>
    )
  }

  const put = (id: string, v: string | string[]) => { setErr(null); setA(x => ({ ...x, [id]: v })) }
  const toggle = (id: string, o: string) => {
    const cur = Array.isArray(a[id]) ? (a[id] as string[]) : []
    put(id, cur.includes(o) ? cur.filter(x => x !== o) : [...cur, o])
  }
  const send = async () => {
    if (p.id === PREVIEW_ID) return
    const gap = qs.find(q => q.required && (!a[q.id] || (Array.isArray(a[q.id]) ? !(a[q.id] as string[]).length : !String(a[q.id]).trim())))
    if (gap) { setErr(`Answer "${gap.label}" first`); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('digest_form_submit', { p_id: p.id, p_answers: a })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setEditing(false); void load()
  }
  return (
    <div className="digest-form">
      {qs.map(q => {
        const v = a[q.id]
        return (
          <div key={q.id} className="digest-field">
            <span className="digest-field-label">{q.label}{q.required && <i aria-hidden> *</i>}</span>
            {q.qtype === 'short' && <input value={(v as string) ?? ''} maxLength={300} onChange={e => put(q.id, e.target.value)} />}
            {q.qtype === 'long' && <textarea rows={3} value={(v as string) ?? ''} maxLength={3000} onChange={e => put(q.id, e.target.value)} />}
            {q.qtype === 'number' && <input type="number" inputMode="decimal" value={(v as string) ?? ''} onChange={e => put(q.id, e.target.value)} />}
            {q.qtype === 'date' && <input type="date" value={(v as string) ?? ''} onChange={e => put(q.id, e.target.value)} />}
            {(q.qtype === 'one' || q.qtype === 'yesno') && (
              <div className="digest-field-choices">
                {(q.qtype === 'yesno' ? ['Yes', 'No'] : q.options).map(o => (
                  <button key={o} type="button" className={v === o ? 'digest-option on' : 'digest-option'} onClick={() => put(q.id, o)}>
                    <span className="digest-tick">{v === o && <Check size={12} />}</span>{o}
                  </button>
                ))}
              </div>
            )}
            {q.qtype === 'many' && (
              <div className="digest-field-choices">
                {q.options.map(o => {
                  const on = Array.isArray(v) && v.includes(o)
                  return (
                    <button key={o} type="button" className={on ? 'digest-option on' : 'digest-option'} onClick={() => toggle(q.id, o)}>
                      <span className="digest-tick box">{on && <Check size={12} />}</span>{o}
                    </button>
                  )
                })}
              </div>
            )}
            {q.qtype === 'rating' && (
              <div className="digest-rating">
                {['1', '2', '3', '4', '5'].map(n => (
                  <button key={n} type="button" className={v === n ? 'on' : ''} onClick={() => put(q.id, n)}>{n}</button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {err && <p className="digest-poll-err">{err}</p>}
      <div className="digest-poll-go">
        <span className="digest-poll-meta">{closes ? `Closes ${closesOn(closes)}` : ''}</span>
        <button type="button" className="digest-vote" disabled={busy} onClick={send}><Send size={15} /> {sent ? 'Send changes' : 'Send'}</button>
      </div>
    </div>
  )
}

/* ---- Videos (KPI 0185; the user, 13 Oct: "we are posting videos in YouTube") ---- */
type YTPlayer = { getCurrentTime(): number; getDuration(): number; destroy(): void }
let ytApi: Promise<unknown> | null = null
/** YouTube's player, loaded once. */
function loadYouTube(): Promise<unknown> {
  const w = window as unknown as { YT?: { Player: unknown }; onYouTubeIframeAPIReady?: () => void }
  if (ytApi) return ytApi
  ytApi = new Promise(resolve => {
    if (w.YT?.Player) { resolve(w.YT); return }
    const before = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => { before?.(); resolve(w.YT) }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  })
  return ytApi
}

/**
 * Plays inside Digest, so the player can say how far each person got: the furthest point they
 * reached, sent every 15 seconds while it plays, and on pause, at the end and on closing.
 */
function VideoPlayer({ postId, videoId }: { postId: string; videoId: string }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let player: YTPlayer | null = null
    let furthest = 0
    let sent = -1
    let timer = 0
    let gone = false
    const report = () => {
      if (!player || postId === PREVIEW_ID) return
      const at = Math.floor(player.getCurrentTime?.() ?? 0)
      furthest = Math.max(furthest, at)
      if (furthest === sent) return
      sent = furthest
      void supabase.rpc('digest_video_progress', { p_id: postId, p_seconds: furthest, p_duration: Math.round(player.getDuration?.() ?? 0) }).then(() => {}, () => {})
    }
    void loadYouTube().then(yt => {
      if (gone || !box.current) return
      const YT = yt as { Player: new (el: HTMLElement, o: object) => YTPlayer; PlayerState: { PLAYING: number } }
      player = new YT.Player(box.current, {
        videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onStateChange: (e: { data: number }) => {
            window.clearInterval(timer)
            if (e.data === YT.PlayerState.PLAYING) timer = window.setInterval(report, 15_000)
            report()
          },
        },
      })
    })
    return () => { gone = true; window.clearInterval(timer); report(); player?.destroy() }
  }, [postId, videoId])
  return <div className="digest-video"><div ref={box} /></div>
}

function Sheet({ label, onClose, children, wide, video }: { label: string; onClose: () => void; children: React.ReactNode; wide?: boolean; video?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="sheet-shade" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={video ? 'sheet digest-sheet video' : wide ? 'sheet digest-sheet wide' : 'sheet digest-sheet'} role="dialog" aria-modal="true" aria-label={label}>
        <button type="button" className="digest-sheet-close" onClick={onClose} title="Close"><X size={18} /><span className="sr">Close</span></button>
        {children}
      </div>
    </div>
  )
}

function PostSheet({ p, onClose, onLike, onJoin }: { p: Post; onClose: () => void; onLike: (p: Post) => void; onJoin: (p: Post) => void }) {
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (p.id === PREVIEW_ID) return
    void supabase.rpc('digest_opened', { p_id: p.id }).then(() => {}, () => {})
  }, [p.id])
  const load = useCallback(async () => {
    if (p.id === PREVIEW_ID) { setComments([]); return }
    const { data } = await supabase.rpc('digest_comments_for', { p_id: p.id })
    setComments((data ?? []) as Comment[])
  }, [p.id])
  useEffect(() => { void load() }, [load])

  const add = async () => {
    if (!text.trim() || p.id === PREVIEW_ID) return
    setBusy(true)
    const { error } = await supabase.rpc('digest_add_comment', { p_id: p.id, p_body: text.trim() })
    setBusy(false)
    if (!error) { setText(''); void load() }
  }
  const remove = async (id: string) => { await supabase.rpc('digest_delete_comment', { p_id: id }); void load() }
  const kind = KIND_WORD[p.kind]
  const place = where(p)
  const body = (
      <div className="digest-sheet-body" style={tint(p.color)}>
        {p.kind === 'meeting' && (
          <div className="digest-sheet-meet">
            <span><Clock size={15} /> {new Date(p.meet_at!).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · {when(p)}</span>
            {place && <span><MapPin size={15} /> {place}</span>}
            <JoinButton p={p} onJoin={onJoin} className="digest-sheet-btn" />
          </div>
        )}
        {p.kind === 'vacancy' && (
          <div className="digest-sheet-meet">
            {p.vac_location && <span><MapPin size={15} /> {p.vac_location}</span>}
            {p.apply_by && <span><CalendarClock size={15} /> Apply by {new Date(p.apply_by).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
            {p.apply_link && (
              <a className="digest-sheet-btn" href={applyHref(p.apply_link)} target="_blank" rel="noreferrer"><Briefcase size={16} /> Apply</a>
            )}
          </div>
        )}
        {p.body && <Md className="digest-panel-body" text={p.body} />}
        {p.kind === 'poll' && <PollBody p={p} />}
        {p.kind === 'form' && <FormBody p={p} />}
        {p.kind !== 'meeting' && p.kind !== 'poll' && p.kind !== 'form' && (
          <button type="button" className={p.liked ? 'digest-bigheart on' : 'digest-bigheart'} onClick={() => onLike(p)} aria-pressed={p.liked}>
            <Heart size={18} fill={p.liked ? 'currentColor' : 'none'} /> {p.likes} {p.likes === 1 ? 'like' : 'likes'}
          </button>
        )}

        <div className="digest-comments">
          <p className="digest-comments-h"><MessageCircle size={16} /> Comments{comments?.length ? ` · ${comments.length}` : ''}</p>
          {comments?.map(c => (
            <div key={c.id} className="digest-comment">
              <span className="digest-avatar" style={{ background: grad(p.color) }}>{c.author.split(/\s+/).map(w => w[0]).slice(0, 2).join('')}</span>
              <div>
                <p><strong>{c.author}</strong> <span>{ago(c.created_at)}</span></p>
                <p>{c.body}</p>
              </div>
              {c.mine && <button type="button" className="icon-btn" onClick={() => remove(c.id)} title="Delete"><Trash2 size={14} /><span className="sr">Delete</span></button>}
            </div>
          ))}
          <div className="digest-write">
            <input value={text} maxLength={500} placeholder="Write a comment" onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void add() }} />
            <button type="button" className="digest-send" onClick={add} disabled={busy || !text.trim()} title="Send"><Send size={16} /><span className="sr">Send</span></button>
          </div>
        </div>
      </div>
  )

  if (p.kind === 'video' && p.video_id) {
    return (
      <Sheet label={p.title} onClose={onClose} video>
        <VideoPlayer postId={p.id} videoId={p.video_id} />
        <div className="digest-split-head" style={tint(p.color)}>
          <span className="digest-split-kind"><KindIcon p={p} size={14} /> {kind}</span>
          <h2>{p.title}</h2>
          <p>{desk(p)} · {ago(p.created_at)}</p>
        </div>
        {body}
      </Sheet>
    )
  }

  return (
    <Sheet label={p.title} onClose={onClose} wide={!!p.image_url}>
      {p.image_url ? (
        /* A picture is shown whole, never cropped under the title (the user, 10 Oct: "I posted a long
           pic"): on a desktop the picture left and the words right, on a phone the picture first. */
        <div className="digest-split">
          <a className="digest-split-img" href={p.image_url} target="_blank" rel="noreferrer" title="Open the full picture">
            <img src={p.image_url} alt={p.title} />
          </a>
          <div className="digest-split-side">
            <div className="digest-split-head" style={tint(p.color)}>
              <span className="digest-split-kind"><KindIcon p={p} size={14} /> {kind}</span>
              <h2>{p.title}</h2>
              <p>{desk(p)} · {ago(p.created_at)}</p>
            </div>
            {body}
          </div>
        </div>
      ) : (
        <>
          {/* Filled, in the post's own colour (the user, 10 Oct: "make it awesome and filled"). */}
          <div className="digest-sheet-hero" style={{ background: cover(p) }}>
            <span className="digest-sheet-art" aria-hidden><KindIcon p={p} size={120} /></span>
            <span className="digest-sheet-kind"><KindIcon p={p} size={14} /> {kind}</span>
            <h2>{p.title}</h2>
            <p>{desk(p)} · {ago(p.created_at)}</p>
          </div>
          {body}
        </>
      )}
    </Sheet>
  )
}

/**
 * A draft as people will see it (the user, 12 Oct: "need a preview for all mode of digests so
 * user can see how it will look in user page"). KPI's Digest page shows this page in a frame and
 * sends the draft by postMessage; it is drawn with the very cards and pop-up of the home page,
 * as the home page card or opened. Nothing is read or written.
 */
export function DigestPreview() {
  const [post, setPost] = useState<Post | null>(null)
  const [view, setView] = useState<'card' | 'open'>('card')
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as { type?: string; post?: Post; options?: string[]; multi?: boolean; closes?: string | null
        questions?: Array<{ label: string; qtype: QType; options: string[]; required: boolean }> } | null
      if (!d || d.type !== 'cyrix-digest-preview' || !d.post) return
      previewOptions = (d.options ?? []).map((label, i) => ({
        id: 'o' + i, label, votes: 0, mine: false, closes_at: d.closes ?? null, multi: !!d.multi, voters: 0,
      }))
      previewForm = (d.questions ?? []).map((q, i) => ({
        id: 'q' + i, label: q.label.trim() || 'Your question', qtype: q.qtype, options: q.options.filter(o => o.trim()),
        required: q.required, closes_at: d.closes ?? null, mine: null, sent_at: null, answered: 0,
      }))
      setPost({ ...d.post, id: PREVIEW_ID })
    }
    window.addEventListener('message', on)
    // Ready: the page that framed this sends the draft now, and again whenever it changes.
    window.parent.postMessage({ type: 'cyrix-digest-preview-ready' }, '*')
    return () => window.removeEventListener('message', on)
  }, [])
  const noop = () => {}
  if (!post) return null
  return (
    <div className="digest-preview">
      <div className="digest-preview-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'card'} className={view === 'card' ? 'on' : ''} onClick={() => setView('card')}>On the home page</button>
        <button type="button" role="tab" aria-selected={view === 'open'} className={view === 'open' ? 'on' : ''} onClick={() => setView('open')}>Opened</button>
      </div>
      {view === 'card' ? (
        <section className="digest">
          <div className="digest-grid digest-preview-grid" key={JSON.stringify(post) + previewOptions.length + JSON.stringify(previewForm)}>
            {post.kind === 'meeting' ? <MeetingCard p={post} onJoin={noop} onOpen={() => setView('open')} />
              : post.kind === 'poll' ? <PollCard p={post} onOpen={() => setView('open')} />
              : post.kind === 'form' ? <FormCard p={post} onOpen={() => setView('open')} />
              : <NewsCard p={post} onLike={noop} onOpen={() => setView('open')} />}
          </div>
        </section>
      ) : (
        <PostSheet key={JSON.stringify(post) + previewOptions.length + JSON.stringify(previewForm)} p={post} onClose={() => setView('card')} onLike={noop} onJoin={noop} />
      )}
    </div>
  )
}
