import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import Avatar from './Avatar'
import { Camera } from 'lucide-react'
import { fileToAvatar } from './lib/avatar'
import { takeR1 } from './lib/r1Link'

/**
 * Who is signed in, and a card with their basic details on a press (the user,
 * 12 Oct: "profile is not clickable, show the profile details, basic details,
 * not full things from kpi profile").
 *
 * Read-only and short: the employee record is HR's, kept in KPI. The manager's
 * name is read under the same rules as anywhere else (employees_read lets a
 * person see their own manager's row).
 */
interface Details {
  ecode: string; designation: string | null; department: string | null; function_name: string | null
  location: string | null; work_email: string | null; official_phone: string | null
  date_of_joining: string | null; manager: string | null
}

export default function ProfileCard({ name, avatar, onAvatar }: { name: string; avatar: string | null; onAvatar?: (a: string) => void }) {
  const [open, setOpen] = useState(() => takeR1('photo'))
  // Add or change one's own photo from here (the user, 11 Nov); it goes through set_my_avatar (KPI 0037) like KPI's.
  const pick = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [top, setTop] = useState<number | null>(null)
  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setErr(null)
    try {
      const url = await fileToAvatar(file)
      const { error } = await supabase.rpc('set_my_avatar', { p_data: url })
      if (error) throw new Error(error.message)
      onAvatar?.(url)
    } catch (e) { setErr(e instanceof Error ? e.message : 'The photo could not be saved.') }
    finally { setBusy(false); if (pick.current) pick.current.value = '' }
  }
  const [d, setD] = useState<Details | null>(null)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open || d) return
    let alive = true
    ;(async () => {
      const { data: auth } = await supabase.auth.getUser()
      const { data: me } = await supabase.from('employees')
        .select('ecode, designation, department, function_name, location, work_email, official_phone, date_of_joining, reporting_manager_id')
        .eq('auth_user_id', auth.user?.id ?? '').maybeSingle()
      if (!alive || !me) return
      const { data: mgr } = me.reporting_manager_id
        ? await supabase.from('employees').select('full_name, ecode').eq('id', me.reporting_manager_id).maybeSingle()
        : { data: null }
      if (!alive) return
      setD({ ...me, manager: mgr ? `${mgr.full_name} · ${mgr.ecode}` : null })
    })()
    return () => { alive = false }
  }, [open, d])

  // Closes on a press outside it or on Escape.
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const rows: Array<[string, string | null | undefined]> = d ? [
    ['Employee code', d.ecode],
    ['Designation', d.designation],
    ['Department', d.department],
    ['Function', d.function_name],
    ['Location', d.location],
    ['Reporting manager', d.manager],
    ['Work email', d.work_email],
    ['Phone', d.official_phone],
    ['Joined', d.date_of_joining && new Date(d.date_of_joining).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })],
  ] : []

  return (
    <span className="who-wrap" ref={box}>
      <button type="button" className="who" aria-expanded={open} aria-haspopup="dialog"
        onClick={e => { setTop(e.currentTarget.getBoundingClientRect().bottom + 8); setOpen(v => !v) }}>
        <span className="who-name">{name}</span>
        <Avatar name={name} src={avatar} />
      </button>
      {open && (
        <span className="profile-card" role="dialog" aria-label="Your profile" style={top != null ? { ['--pc-top' as string]: `${top}px` } : undefined}>
          <span className="profile-head">
            <button type="button" className="profile-photo" onClick={() => pick.current?.click()} disabled={busy} aria-label={avatar ? 'Change photo' : 'Add photo'}>
              <Avatar name={name} src={avatar} />
              <span className="profile-photo-cam" aria-hidden><Camera size={12} strokeWidth={2.4} /></span>
            </button>
            <input ref={pick} type="file" accept="image/*" hidden onChange={e => void upload(e.target.files?.[0])} />
            <span>
              <span className="profile-name">{name}</span>
              {d?.designation && <span className="profile-sub">{d.designation}</span>}
            </span>
          </span>
          {err && <span className="profile-photo-err" role="alert">{err}</span>}
          {!d ? (
            <span className="profile-sub profile-loading">Loading…</span>
          ) : (
            <dl className="profile-rows">
              {rows.filter(([, v]) => v).map(([k, v]) => (
                <span key={k} className="profile-row">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </span>
              ))}
            </dl>
          )}
        </span>
      )}
    </span>
  )
}
