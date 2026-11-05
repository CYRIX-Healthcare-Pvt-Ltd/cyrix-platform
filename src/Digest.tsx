import { local } from './lib/storage'
import Md, { plain } from './Md'
import FileView from './FileView'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Heart, MessageCircle, Megaphone, Newspaper, Send, Trash2, Video, X, MapPin, Clock, ChevronRight, BarChart3, Check,
  TriangleAlert, Pin, Briefcase, CalendarClock, ClipboardList, Pencil, PlayCircle, Play, FileText, Trophy, EyeOff, Timer,
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
  posted_as: 'hr' | 'it' | 'mkt' | 'mgmt'; author: string | null; created_at: string
  likes: number; liked: boolean; comments: number
  /** A vacancy (0170): where, apply by, and how to apply. */
  vac_location: string | null; apply_by: string | null; apply_link: string | null
  /** A meeting has a link, even while it is kept back until 15 minutes before (KPI 0182). */
  has_link?: boolean
  /** Minutes before the start that Join opens, and a Video post's YouTube id (KPI 0185). */
  join_early?: number; video_id?: string | null
  /** A draft sent to this person as a test (KPI 0187): only they see it, and Join works at once. */
  is_test?: boolean
  /** A file on the post (KPI 0215): a PDF opens in the browser's viewer, where its links work. */
  pdf_url?: string | null; pdf_name?: string | null
}
/** Every kind of post (0170; the user: "announcement, alerts, notice, vacancy"). */
type Kind = 'news' | 'announcement' | 'alert' | 'notice' | 'vacancy' | 'meeting' | 'poll' | 'form' | 'video' | 'quiz'
const KIND_WORD: Record<Kind, string> = {
  news: 'News', announcement: 'Announcement', alert: 'Alert', notice: 'Notice', vacancy: 'Vacancy', meeting: 'Meeting', poll: 'Poll', form: 'Form', video: 'Video', quiz: 'Quiz',
}
/** One of the named colours, or any colour as #rrggbb (0168). */
type Hue = string
interface Comment { id: string; author: string; ecode: string; body: string; created_at: string; mine: boolean; reply?: string | null; reply_desk?: string | null; reply_at?: string | null }
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
const DESK_WORD: Record<string, string> = { hr: 'HR', it: 'IT', mkt: 'Marketing', mgmt: 'Management' }
const desk = (p: Post) => DESK_WORD[p.posted_as] ?? 'HR'
/** Where the meeting is: what was typed, else read off the link (the user: "what if it is Google Meet"). */
const where = (p: Post) => {
  if (p.meet_place) return p.meet_place
  const l = (p.meet_link ?? '').toLowerCase()
  return l.includes('meet.google') ? 'Google Meet' : l.includes('teams.') ? 'Microsoft Teams' : l.includes('zoom.') ? 'Zoom' : null
}
const KindIcon = ({ p, size = 18 }: { p: Post; size?: number }) => {
  const I = { news: Newspaper, announcement: Megaphone, alert: TriangleAlert, notice: Pin, vacancy: Briefcase, meeting: Video, poll: BarChart3, form: ClipboardList, video: PlayCircle, quiz: Trophy }[p.kind] ?? Newspaper
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
const lastLook = () => { try { return Number(local.getItem(LAST_LOOK) ?? 0) } catch { return 0 } }
const looked = () => { try { local.setItem(LAST_LOOK, String(Date.now())) } catch { /* private window */ } }

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

/*
  A phone's back gesture closes an open sheet, not the app (the user, 14 Oct: "swiped back then the whole
  app is going back"). Opening pushes a history step; back pops it and closes the sheet. Closing with the
  X takes the step back off. Nested sheets each hold their own step, so back closes the top one first.
*/
function useBackCloses(open: boolean, close: () => void) {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    const mark = Math.random().toString(36).slice(2)
    window.history.pushState({ ...(window.history.state ?? {}), sheet: mark }, '')
    let popped = false
    const onPop = () => {
      if (window.history.state?.sheet === mark) return
      popped = true
      closeRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (!popped && window.history.state?.sheet === mark) window.history.back()
    }
  }, [open])
}

/*
  Likes, comments and counts stay current by themselves (the user, 15 Oct): only the data is fetched
  again, never the page, so nothing flickers, the scroll stays put and an open post stays open.
  Every so often while the page is on screen, and at once when someone comes back to the tab or app.
*/
function useLiveRefresh(refresh: () => void, ms: number) {
  const ref = useRef(refresh)
  ref.current = refresh
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') ref.current() }
    const t = window.setInterval(tick, ms)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [ms])
}

export default function Digest() {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [open, setOpen] = useState<Post | null>(null)
  const [all, setAll] = useState(false)
  useBackCloses(all, () => setAll(false))
  useBackCloses(!!open, () => { setOpen(null); void load() })

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('digest_feed', { p_limit: 30 })
    const rows = (data ?? []) as Post[]
    setPosts(rows)
    // A device notification opens its post (?post=<id>), so tapping it counts as Opened (the user, 14 Oct).
    const want = new URLSearchParams(window.location.search).get('post')
    if (want) {
      const hit = rows.find(r => r.id === want)
      if (hit) setOpen(hit)
      const u = new URL(window.location.href); u.searchParams.delete('post'); window.history.replaceState(null, '', u.pathname + u.search + u.hash)
    }
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
  // The counts only: no "seen" marks, no opening a post from the link again.
  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc('digest_feed', { p_limit: 30 })
    if (!data) return
    const rows = data as Post[]
    setPosts(rows)
    setOpen(o => (o ? rows.find(r => r.id === o.id) ?? o : o))
  }, [])
  useLiveRefresh(() => { void refresh() }, 60_000)

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
      : p.kind === 'quiz'
      ? <QuizCard key={p.id} p={p} onOpen={setOpen} />
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
            <p>News, meetings and polls from HR, IT, Marketing and Management.</p>
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
                {p.kind !== 'meeting' && p.kind !== 'poll' && p.kind !== 'form' && p.kind !== 'quiz' && <span className="digest-row-n"><Heart size={13} /> {p.likes}</span>}
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
      {p.body && <p className="digest-meeting-body">{plain(p.body)}</p>}
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
        {p.body && <p>{plain(p.body)}</p>}
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
let previewAnonymous = false
let previewAgain = false
let previewQuiz: { shuffle: boolean; seconds: number | null } = { shuffle: false, seconds: null }

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
  const [anonymous, setAnonymous] = useState(false)
  const [again, setAgain] = useState(false)
  const load = useCallback(async () => {
    if (id === PREVIEW_ID) { setQs(previewForm); setAnonymous(previewAnonymous); setAgain(previewAgain); return }
    const [{ data }, { data: anon }, { data: ag }] = await Promise.all([
      supabase.rpc('digest_form', { p_id: id }),
      supabase.rpc('digest_form_is_anonymous', { p_id: id }),
      supabase.rpc('digest_allow_again', { p_id: id }),
    ])
    setAnonymous(!!anon); setAgain(!!ag)
    setQs((data ?? []) as FormQ[])
  }, [id])
  useEffect(() => { void load() }, [load])
  return { qs, load, anonymous, again }
}
/** An anonymous form (KPI 0254; the user, 5 Nov: "user should see it wont record user details"). */
const AnonNote = () => <p className="digest-anon"><EyeOff size={14} /> Anonymous · your name and E-code are not kept with your answers</p>
// The day and the time it closes (the user, 15 Oct: "time not showing"): 15 Oct, 6:00 PM.
const closesOn = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/(am|pm)/i, m => m.toUpperCase())

function FormCard({ p, onOpen }: { p: Post; onOpen: (p: Post) => void }) {
  const { qs, anonymous, again } = useForm(p.id)
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
        {qs && <p className="digest-form-sub">{qs.length} {qs.length === 1 ? 'question' : 'questions'}{anonymous ? ' · anonymous' : ''}{closes ? ` · ${closed ? 'closed' : 'closes ' + closesOn(closes)}` : ''}</p>}
      </div>
      <div className="digest-pollcard-body">
        {sent
          ? <p className="digest-form-sent"><Check size={15} /> Submitted{!closed && closes && again ? ` · you can change it until ${closesOn(closes)}` : ''}</p>
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
  const { qs, load, anonymous, again } = useForm(p.id)
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
          ? <p className="digest-form-sent"><Check size={15} /> Submitted {new Date(qs[0].sent_at!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
          : <p className="digest-poll-meta">This form has closed.</p>}
        {sent && anonymous && <AnonNote />}
        {sent && !anonymous && qs.map(q => (
          <div key={q.id} className="digest-form-a"><span>{q.label}</span><strong>{show(qs[0].mine?.[q.id])}</strong></div>
        ))}
        {sent && !closed && again && !anonymous && <p className="digest-poll-meta"><button type="button" onClick={() => setEditing(true)}>Change answers</button>{closes ? ` · until ${closesOn(closes)}` : ''}</p>}
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
      {anonymous && <AnonNote />}
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
        <button type="button" className="digest-vote" disabled={busy} onClick={send}><Send size={15} /> {sent ? 'Send changes' : 'Submit'}</button>
      </div>
    </div>
  )
}

/* ---- Quizzes (KPI 0253, 0255; the user, 5 Nov: "on submit by user, he should see the result, ie scored, and
   question and answers, if wrong show the correct answer") ---- */
interface QuizQ {
  id: string; label: string; qtype: 'one' | 'many' | 'short'; options: string[]; points: number
  /** Only once this person has sent theirs. */
  correct: string[] | null
  closes_at: string | null; mine: Record<string, string | string[]> | null; sent_at: string | null
  score: number | null; max_score: number | null
}
interface QuizSettings { shuffle: boolean; seconds: number | null; left: number | null }
function useQuiz(id: string) {
  const [qs, setQs] = useState<QuizQ[] | null>(null)
  const [again, setAgain] = useState(false)
  const [settings, setSettings] = useState<QuizSettings | null>(null)
  const load = useCallback(async () => {
    if (id === PREVIEW_ID) {
      setAgain(previewAgain)
      setSettings({ shuffle: previewQuiz.shuffle, seconds: previewQuiz.seconds, left: null })
      setQs(previewForm.map(q => ({ id: q.id, label: q.label, qtype: (q.qtype === 'many' || q.qtype === 'short' ? q.qtype : 'one'), options: q.options,
        points: 1, correct: null, closes_at: q.closes_at, mine: null, sent_at: null, score: null, max_score: null })))
      return
    }
    const [{ data }, { data: ag }, { data: set }] = await Promise.all([
      supabase.rpc('digest_quiz', { p_id: id }),
      supabase.rpc('digest_allow_again', { p_id: id }),
      supabase.rpc('digest_quiz_settings', { p_id: id }),
    ])
    setAgain(!!ag)
    setSettings((set as QuizSettings | null) ?? { shuffle: false, seconds: null, left: null })
    setQs((data ?? []) as QuizQ[])
  }, [id])
  useEffect(() => { void load() }, [load])
  return { qs, load, again, settings }
}
/** 90 → "1:30". */
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
/** The quiz's timer in words on its card: 1 min 30 sec. */
const timerWords = (sec: number) => [Math.floor(sec / 60) && `${Math.floor(sec / 60)} min`, sec % 60 && `${sec % 60} sec`].filter(Boolean).join(' ')
/**
 * A shuffled quiz (KPI 0258; the user, 5 Nov: "for some user question 1 will be question 2 of others"): an order of the
 * person's own, from the post and who they are, so it is the same each time they open it.
 */
function useOrder(postId: string, on: boolean) {
  const [who, setWho] = useState('')
  useEffect(() => { if (on) void supabase.auth.getSession().then(({ data }) => setWho(data.session?.user.id ?? '')) }, [on])
  const hash = (t: string) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
  return function order<T>(items: T[], salt = ''): T[] {
    if (!on) return items
    const key = (x: T) => hash(`${postId}|${who}|${salt}|${typeof x === 'string' ? x : (x as { id: string }).id}`)
    return [...items].sort((x, y) => key(x) - key(y))
  }
}
const norm = (t: string) => t.replace(/\s+/g, '').toLowerCase()
/** Whether one answer earned its marks, the way the server counted it. */
const isRight = (q: QuizQ, v: string | string[] | undefined) => {
  const c = q.correct ?? []
  if (q.qtype === 'many') { const a = Array.isArray(v) ? v : []; return a.length === c.length && a.every(x => c.includes(x)) }
  if (q.qtype === 'short') return typeof v === 'string' && c.some(x => norm(x) === norm(v))
  return typeof v === 'string' && c.includes(v)
}

function QuizCard({ p, onOpen }: { p: Post; onOpen: (p: Post) => void }) {
  const { qs, settings } = useQuiz(p.id)
  const closes = qs?.[0]?.closes_at ?? null
  const closed = !!closes && new Date(closes).getTime() < Date.now()
  const sent = !!qs?.[0]?.sent_at
  const total = qs?.reduce((t, q) => t + q.points, 0) ?? 0
  return (
    <article className="digest-pollcard" style={tint(p.color)}>
      <div className="digest-pollcard-head" style={{ background: grad(p.color) }}>
        <div className="digest-meeting-top">
          <span className="digest-badge"><Trophy size={13} /> Quiz</span>
          {p.is_test && <span className="digest-test-chip">Test · only you can see this</span>}
          <span className="digest-by">{desk(p)}</span>
        </div>
        <button type="button" className="digest-pollcard-q" onClick={() => onOpen(p)}>{p.title}</button>
        {qs && <p className="digest-form-sub">{qs.length} {qs.length === 1 ? 'question' : 'questions'} · {total} marks{settings?.seconds ? ` · ${timerWords(settings.seconds)}` : ''}{closes ? ` · ${closed ? 'closed' : 'closes ' + closesOn(closes)}` : ''}</p>}
      </div>
      <div className="digest-pollcard-body">
        {sent
          ? <button type="button" className="digest-quiz-mini" onClick={() => onOpen(p)}><Trophy size={15} /> You scored {qs![0].score} of {qs![0].max_score}</button>
          : closed ? <p className="digest-poll-meta">This quiz has closed.</p>
          : settings?.seconds
            ? <div className="digest-quiz-timed">
                <span><Timer size={15} /> {timerWords(settings.seconds)}</span>
                <button type="button" className="digest-vote digest-form-go" onClick={() => onOpen(p)}><Play size={15} /> Start quiz</button>
              </div>
            : <button type="button" className="digest-vote digest-form-go" onClick={() => onOpen(p)}><Pencil size={15} /> Take the quiz</button>}
        <div className="digest-news-foot">
          <button type="button" className="digest-like" onClick={() => onOpen(p)}><MessageCircle size={16} /> {p.comments}</button>
          <span className="digest-ago">{ago(p.created_at)}</span>
        </div>
      </div>
    </article>
  )
}

/** Answer every question, send once, and see the result straight away; with a timer, Start first (KPI 0258). */
function QuizBody({ p }: { p: Post }) {
  const { qs, load, again, settings } = useQuiz(p.id)
  const [a, setA] = useState<Record<string, string | string[]>>({})
  const [retake, setRetake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // The moment time runs out, by this phone's clock, from the seconds the server says are left.
  const [deadline, setDeadline] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const order = useOrder(p.id, !!settings?.shuffle)
  const answers = useRef(a); answers.current = a
  const sentAuto = useRef(false)

  // A start already running (the page was closed and opened again) carries on where the server's clock is.
  useEffect(() => {
    if (settings?.left != null && deadline == null) setDeadline(Date.now() + settings.left * 1000)
  }, [settings, deadline])
  useEffect(() => {
    if (deadline == null) return
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [deadline])

  const send = useCallback(async (auto: boolean) => {
    if (p.id === PREVIEW_ID) return
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('digest_quiz_submit', { p_id: p.id, p_answers: answers.current })
    setBusy(false)
    if (error) { if (!auto) setErr(error.message); return }
    setRetake(false); setDeadline(null); sentAuto.current = false
    void load()
  }, [p.id, load])
  // Time up: what is answered goes, the rest counts as wrong.
  const left = deadline == null ? null : Math.max(0, Math.ceil((deadline - now) / 1000))
  useEffect(() => {
    if (left === 0 && !sentAuto.current && p.id !== PREVIEW_ID) { sentAuto.current = true; void send(true) }
  }, [left, send, p.id])

  if (!qs || !settings) return <div className="digest-poll-skel" />
  const closes = qs[0]?.closes_at ?? null
  const closed = !!closes && new Date(closes).getTime() < Date.now()
  const sent = !!qs[0]?.sent_at
  const show = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : v) || '—'
  const list = order(qs)

  if (sent && !retake && deadline == null) {
    const got = qs[0].score ?? 0, of = qs[0].max_score ?? 0
    return (
      <div className="digest-form">
        <div className="digest-quiz-score">
          <Trophy size={22} />
          <div><strong>{got} of {of}</strong><span>{of ? Math.round((got / of) * 100) : 0}% · {qs.filter(q => isRight(q, qs[0].mine?.[q.id])).length} of {qs.length} correct</span></div>
        </div>
        {list.map((q, i) => {
          const v = qs[0].mine?.[q.id]
          const ok = isRight(q, v)
          return (
            <div key={q.id} className={ok ? 'digest-quiz-q right' : 'digest-quiz-q wrong'}>
              <p className="digest-quiz-label"><span>{i + 1}.</span> {q.label}<em>{ok ? q.points : 0} / {q.points}</em></p>
              <p className="digest-quiz-mine">{ok ? <Check size={15} /> : <X size={15} />} {show(v)}</p>
              {!ok && <p className="digest-quiz-right"><Check size={15} /> {q.qtype === 'short' ? (q.correct ?? [])[0] : (q.correct ?? []).join(', ')}</p>}
            </div>
          )
        })}
        {again && !closed && (
          <p className="digest-poll-meta"><button type="button" onClick={() => { setA({}); setErr(null); setRetake(true); void load() }}>Take it again</button>{closes ? ` · until ${closesOn(closes)}` : ''}</p>
        )}
      </div>
    )
  }
  if (closed && deadline == null) return <div className="digest-form"><p className="digest-poll-meta">This quiz has closed.</p></div>

  // With a timer: nothing shows until Start (the user, 5 Nov: "should have start then on start time should tick").
  if (settings.seconds && deadline == null) {
    const total = qs.reduce((t, q) => t + q.points, 0)
    const start = async () => {
      if (p.id === PREVIEW_ID) { setDeadline(Date.now() + settings.seconds! * 1000); return }
      setBusy(true); setErr(null)
      const { data, error } = await supabase.rpc('digest_quiz_start', { p_id: p.id })
      setBusy(false)
      if (error) { setErr(error.message); return }
      setA({}); setDeadline(Date.now() + Number(data ?? 0) * 1000)
    }
    return (
      <div className="digest-form">
        <div className="digest-quiz-start">
          <p><Timer size={18} /> <strong>{clock(settings.seconds)}</strong></p>
          <p className="digest-poll-meta">{qs.length} {qs.length === 1 ? 'question' : 'questions'} · {total} marks</p>
          <p className="digest-quiz-start-note">The timer starts when you press Start quiz.</p>
          {err && <p className="digest-poll-err">{err}</p>}
          <button type="button" className="digest-vote" disabled={busy} onClick={start}><Play size={15} /> Start quiz</button>
        </div>
      </div>
    )
  }

  const put = (id: string, v: string | string[]) => { setErr(null); setA(x => ({ ...x, [id]: v })) }
  const toggle = (id: string, o: string) => {
    const cur = Array.isArray(a[id]) ? (a[id] as string[]) : []
    put(id, cur.includes(o) ? cur.filter(x => x !== o) : [...cur, o])
  }
  const submit = () => {
    const gap = deadline == null && qs.find(q => !a[q.id] || (Array.isArray(a[q.id]) ? !(a[q.id] as string[]).length : !String(a[q.id]).trim()))
    if (gap) { setErr(`Answer "${gap.label}" first`); return }
    void send(false)
  }
  return (
    <div className="digest-form">
      {/* Pinned at the top while the questions scroll; amber in the last 30 seconds, red and beating in the last 10 (the user, 5 Nov). */}
      {left != null && (
        <div className={['digest-quiz-clock', left <= 30 ? 'warn' : '', left <= 10 ? 'low' : '', left === 0 ? 'out' : ''].join(' ').trim()} role="timer" aria-live="off"
          style={{ '--left': settings.seconds ? left / settings.seconds : 0 } as React.CSSProperties}>
          <Timer size={16} /> <span key={left <= 10 ? left : 'n'} className="digest-quiz-clock-n">{clock(left)}</span>
          <i aria-hidden />
        </div>
      )}
      {left === 0 && (
        <div className="digest-quiz-up" role="status"><Timer size={30} /><strong>Time's up</strong><span>Sending your answers</span></div>
      )}
      {list.map((q, i) => {
        const v = a[q.id]
        return (
          <div key={q.id} className="digest-field">
            <span className="digest-field-label">{i + 1}. {q.label}<i className="digest-quiz-pts"> · {q.points} {q.points === 1 ? 'mark' : 'marks'}</i></span>
            {q.qtype === 'short' && <input value={(v as string) ?? ''} maxLength={300} onChange={e => put(q.id, e.target.value)} />}
            {q.qtype === 'one' && (
              <div className="digest-field-choices">
                {order(q.options, q.id).map(o => (
                  <button key={o} type="button" className={v === o ? 'digest-option on' : 'digest-option'} onClick={() => put(q.id, o)}>
                    <span className="digest-tick">{v === o && <Check size={12} />}</span>{o}
                  </button>
                ))}
              </div>
            )}
            {q.qtype === 'many' && (
              <div className="digest-field-choices">
                {order(q.options, q.id).map(o => {
                  const on = Array.isArray(v) && v.includes(o)
                  return (
                    <button key={o} type="button" className={on ? 'digest-option on' : 'digest-option'} onClick={() => toggle(q.id, o)}>
                      <span className="digest-tick box">{on && <Check size={12} />}</span>{o}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      {err && <p className="digest-poll-err">{err}</p>}
      <div className="digest-poll-go">
        <span className="digest-poll-meta">{closes && left == null ? `Closes ${closesOn(closes)}` : ''}</span>
        <button type="button" className="digest-vote" disabled={busy || left === 0} onClick={submit}><Send size={15} /> Submit</button>
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
    const html = document.documentElement, body = document.body
    const was = [html.style.overflow, body.style.overflow]
    html.style.overflow = 'hidden'; body.style.overflow = 'hidden'
    return () => { html.style.overflow = was[0]; body.style.overflow = was[1] }
  }, [])
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

/*
  A post's picture, full screen inside the app (the user, 15 Oct: clicking it opened a new tab).
  Fitted to the screen; a tap shows it at full size to scroll around, and pinch zoom works on a
  phone. Close with the X, Escape or the back gesture.
*/
function PictureView({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [full, setFull] = useState(false)
  useBackCloses(true, onClose)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [onClose])
  return (
    <div className={full ? 'picture-view full' : 'picture-view'} role="dialog" aria-modal="true" aria-label={alt}>
      <button type="button" className="picture-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
      <img src={src} alt={alt} onClick={() => setFull(f => !f)} />
    </div>
  )
}

function PostSheet({ p, onClose, onLike, onJoin }: { p: Post; onClose: () => void; onLike: (p: Post) => void; onJoin: (p: Post) => void }) {
  const [zoom, setZoom] = useState(false)
  // The post's file, opened in the app (the user, 17 Oct).
  const [file, setFile] = useState(false)
  useBackCloses(file, () => setFile(false))
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
  // New comments and replies arrive while the post is open.
  useLiveRefresh(() => { if (p.id !== PREVIEW_ID) void load() }, 30_000)

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
        {/* Opened in the browser's own viewer, where a meeting link inside it can be clicked (the user, 17 Oct). */}
        {p.pdf_url && (
          <button type="button" className="digest-sheet-btn" onClick={() => setFile(true)}><FileText size={16} /> {p.pdf_name ?? 'Open file'}</button>
        )}
        {p.kind === 'poll' && <PollBody p={p} />}
        {p.kind === 'form' && <FormBody p={p} />}
        {p.kind === 'quiz' && <QuizBody p={p} />}
        {p.kind !== 'meeting' && p.kind !== 'poll' && p.kind !== 'form' && p.kind !== 'quiz' && (
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
                {/* The posting desk's reply (KPI 0202). */}
                {c.reply && (
                  <div className="digest-reply">
                    <p><strong>{DESK_WORD[c.reply_desk ?? ''] ?? 'Reply'}</strong>{c.reply_at && <span> {ago(c.reply_at)}</span>}</p>
                    <p>{c.reply}</p>
                  </div>
                )}
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
    <>
    {file && p.pdf_url && <FileView url={p.pdf_url} name={p.pdf_name ?? 'File'} onClose={() => setFile(false)} />}
    {zoom && p.image_url && <PictureView src={p.image_url} alt={p.title} onClose={() => setZoom(false)} />}
    <Sheet label={p.title} onClose={onClose} wide={!!p.image_url}>
      {p.image_url ? (
        /* A picture is shown whole, never cropped under the title (the user, 10 Oct: "I posted a long
           pic"): on a desktop the picture left and the words right, on a phone the picture first. */
        <div className="digest-split">
          <button type="button" className="digest-split-img" onClick={() => setZoom(true)} title="See the full picture">
            <img src={p.image_url} alt={p.title} />
          </button>
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
    </>
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
        questions?: Array<{ label: string; qtype: QType; options: string[]; required: boolean }>; anonymous?: boolean; again?: boolean
        quiz?: { shuffle: boolean; seconds: number | null } } | null
      if (!d || d.type !== 'cyrix-digest-preview' || !d.post) return
      previewOptions = (d.options ?? []).map((label, i) => ({
        id: 'o' + i, label, votes: 0, mine: false, closes_at: d.closes ?? null, multi: !!d.multi, voters: 0,
      }))
      previewForm = (d.questions ?? []).map((q, i) => ({
        id: 'q' + i, label: q.label.trim() || 'Your question', qtype: q.qtype, options: q.options.filter(o => o.trim()),
        required: q.required, closes_at: d.closes ?? null, mine: null, sent_at: null, answered: 0,
      }))
      previewAnonymous = !!d.anonymous
      previewAgain = !!d.again
      previewQuiz = d.quiz ?? { shuffle: false, seconds: null }
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
          <div className="digest-grid digest-preview-grid" key={JSON.stringify(post) + previewOptions.length + JSON.stringify(previewForm) + JSON.stringify(previewQuiz)}>
            {post.kind === 'meeting' ? <MeetingCard p={post} onJoin={noop} onOpen={() => setView('open')} />
              : post.kind === 'poll' ? <PollCard p={post} onOpen={() => setView('open')} />
              : post.kind === 'form' ? <FormCard p={post} onOpen={() => setView('open')} />
              : post.kind === 'quiz' ? <QuizCard p={post} onOpen={() => setView('open')} />
              : <NewsCard p={post} onLike={noop} onOpen={() => setView('open')} />}
          </div>
        </section>
      ) : (
        <PostSheet key={JSON.stringify(post) + previewOptions.length + JSON.stringify(previewForm) + JSON.stringify(previewQuiz)} p={post} onClose={() => setView('card')} onLike={noop} onJoin={noop} />
      )}
    </div>
  )
}
