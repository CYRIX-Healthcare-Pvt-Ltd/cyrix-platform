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

/** One thing the company has given this person, from Inventory's inv_my_assets(). */
interface Asset {
  assignment_id: string; category_name: string; name: string
  serial_number: string | null; size: string | null; quantity: number
}

export default function ProfileCard({ name, avatar }: { name: string; avatar: string | null }) {
  const [open, setOpen] = useState(false)
  const [d, setD] = useState<Details | null>(null)
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const box = useRef<HTMLSpanElement>(null)

  // My Assets (Inventory). Silent on any failure — before Inventory is on
  // the live project the function does not exist, and the card is as before.
  useEffect(() => {
    if (!open || assets) return
    let alive = true
    supabase.rpc('inv_my_assets').then(({ data, error }) => {
      if (alive) setAssets(error || !Array.isArray(data) ? [] : (data as Asset[]))
    })
    return () => { alive = false }
  }, [open, assets])

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
          {assets && assets.length > 0 && (
            <span className="profile-assets">
              <span className="profile-assets-head">
                <span>My assets</span>
                <a href="/inventory/mine">See all</a>
              </span>
              <dl className="profile-rows">
                {assets.slice(0, 6).map(a => (
                  <span key={a.assignment_id} className="profile-row">
                    <dt>{a.category_name}</dt>
                    <dd>
                      {a.name}{a.size ? ` · ${a.size}` : ''}{a.quantity > 1 ? ` · ${a.quantity}` : ''}
                      {a.serial_number && <span className="profile-serial">{a.serial_number}</span>}
                    </dd>
                  </span>
                ))}
              </dl>
              {assets.length > 6 && <span className="profile-sub">and {assets.length - 6} more</span>}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
