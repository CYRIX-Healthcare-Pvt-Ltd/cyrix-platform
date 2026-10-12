import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import Avatar from './Avatar'

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

export default function ProfileCard({ name, avatar }: { name: string; avatar: string | null }) {
  const [open, setOpen] = useState(false)
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
      <button type="button" className="who" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="dialog">
        <span className="who-name">{name}</span>
        <Avatar name={name} src={avatar} />
      </button>
      {open && (
        <span className="profile-card" role="dialog" aria-label="Your profile">
          <span className="profile-head">
            <Avatar name={name} src={avatar} />
            <span>
              <span className="profile-name">{name}</span>
              {d?.designation && <span className="profile-sub">{d.designation}</span>}
            </span>
          </span>
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
