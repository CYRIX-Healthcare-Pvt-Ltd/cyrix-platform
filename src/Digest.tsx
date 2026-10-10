import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  Heart, MessageCircle, Megaphone, Newspaper, Send, Trash2, Video, X, MapPin, Clock, ChevronRight, BarChart3, Check,
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
  id: string; kind: 'news' | 'meeting' | 'poll'; title: string; body: string; image_url: string | null; color: Hue
  meet_at: string | null; meet_minutes: number | null; meet_link: string | null; meet_place: string | null
  posted_as: 'hr' | 'it' | 'mkt'; author: string | null; created_at: string
  likes: number; liked: boolean; comments: number
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
const cover = (p: Post) => (p.image_url ? `center/cover no-repeat url(${p.image_url})` : grad(p.color))

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return m <= 1 ? 'just now' : `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  return d < 30 ? `${d} day${d === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
const when = (p: Post) => {
  const s = new Date(p.meet_at!)
  const e = new Date(s.getTime() + (p.meet_minutes ?? 60) * 60000)
  const t = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  return `${s.toLocaleDateString('en-GB', { weekday: 'short' })} · ${t(s)} – ${t(e)}`
}
const desk = (p: Post) => (p.posted_as === 'it' ? 'IT' : p.posted_as === 'mkt' ? 'Marketing' : 'HR')
/** Where the meeting is: what was typed, else read off the link (the user: "what if it is Google Meet"). */
const where = (p: Post) => {
  if (p.meet_place) return p.meet_place
  const l = (p.meet_link ?? '').toLowerCase()
  return l.includes('meet.google') ? 'Google Meet' : l.includes('teams.') ? 'Microsoft Teams' : l.includes('zoom.') ? 'Zoom' : null
}
const KindIcon = ({ p, size = 18 }: { p: Post; size?: number }) =>
  p.kind === 'meeting' ? <Video size={size} /> : p.kind === 'poll' ? <BarChart3 size={size} /> : <Newspaper size={size} />

/** What the home page shows: the next meeting, then the newest, enough to fill the rows. */
function pick(posts: Post[]) {
  const now = Date.now()
  const next = posts
    .filter(p => p.kind === 'meeting' && new Date(p.meet_at!).getTime() + (p.meet_minutes ?? 60) * 60000 > now)
    .sort((a, b) => a.meet_at!.localeCompare(b.meet_at!))[0]
  const rest = posts.filter(p => p.kind !== 'meeting').slice(0, next ? 4 : 6)
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
                    : `${p.kind === 'poll' ? 'Poll' : 'News'} · ${desk(p)} · ${ago(p.created_at)}`}</span>
                </span>
                {p.kind === 'news' && <span className="digest-row-n"><Heart size={13} /> {p.likes}</span>}
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
    <article className="digest-meeting" style={{ background: grad(p.color) }}>
      <div className="digest-meeting-top">
        <span className="digest-badge"><Megaphone size={13} /> Upcoming meeting</span>
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
      {p.body && <p className="digest-meeting-body">{p.body}</p>}
      <div className="digest-meeting-actions">
        <button type="button" className="digest-join" onClick={() => onJoin(p)}><Video size={16} /> Join meeting</button>
      </div>
    </article>
  )
}

function NewsCard({ p, onLike, onOpen }: { p: Post; onLike: (p: Post) => void; onOpen: (p: Post) => void }) {
  return (
    <article className="digest-news" style={tint(p.color)}>
      <button type="button" className="digest-cover" onClick={() => onOpen(p)} style={{ background: cover(p) }} aria-label={p.title}>
        {!p.image_url && <span className="digest-cover-art" aria-hidden><Newspaper size={38} /><i /><i /><i /></span>}
        <span className="digest-chip">{desk(p)}</span>
      </button>
      <div className="digest-news-body">
        <button type="button" className="digest-news-title" onClick={() => onOpen(p)}>{p.title}</button>
        {p.body && <p>{p.body}</p>}
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

/** The question's options, and this person's answer. */
function usePoll(id: string) {
  const [opts, setOpts] = useState<Option[] | null>(null)
  const load = useCallback(async () => {
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

function Sheet({ label, onClose, children, wide }: { label: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="sheet-shade" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={wide ? 'sheet digest-sheet wide' : 'sheet digest-sheet'} role="dialog" aria-modal="true" aria-label={label}>
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
  useEffect(() => { void supabase.rpc('digest_opened', { p_id: p.id }).then(() => {}, () => {}) }, [p.id])
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('digest_comments_for', { p_id: p.id })
    setComments((data ?? []) as Comment[])
  }, [p.id])
  useEffect(() => { void load() }, [load])

  const add = async () => {
    if (!text.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('digest_add_comment', { p_id: p.id, p_body: text.trim() })
    setBusy(false)
    if (!error) { setText(''); void load() }
  }
  const remove = async (id: string) => { await supabase.rpc('digest_delete_comment', { p_id: id }); void load() }
  const kind = p.kind === 'meeting' ? 'Meeting' : p.kind === 'poll' ? 'Poll' : 'News'
  const place = where(p)
  const body = (
      <div className="digest-sheet-body" style={tint(p.color)}>
        {p.kind === 'meeting' && (
          <div className="digest-sheet-meet">
            <span><Clock size={15} /> {new Date(p.meet_at!).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · {when(p)}</span>
            {place && <span><MapPin size={15} /> {place}</span>}
            <button type="button" className="digest-sheet-btn" onClick={() => onJoin(p)}><Video size={16} /> Join meeting</button>
          </div>
        )}
        {p.body && <p className="digest-panel-body">{p.body}</p>}
        {p.kind === 'poll' && <PollBody p={p} />}
        {p.kind === 'news' && (
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


