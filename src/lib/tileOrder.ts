import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { local } from './storage'
import { supabase } from './supabase'

/*
  Arranging the portal tiles (the user, 25 Nov): KPI always first; a long press on a phone, or on a computer a double
  click held on the second press, starts arranging. The other tiles jiggle like an iPhone's, the held tile follows the
  pointer while the others slide aside; a single click ends it, Esc cancels. Saved to the account (0309).
*/
const key = (uid: string) => `cyrix.tiles.${uid}`

/** The account's order (employees.tile_order, 0309), so every phone and computer agrees; this browser's copy until it loads. */
export function useTileOrder(uid: string | undefined, saved: string[] | null) {
  const [order, setOrder] = useState<string[]>([])
  useEffect(() => {
    if (!uid) return
    if (saved) { setOrder(saved); return }
    try { setOrder(JSON.parse(local.getItem(key(uid)) ?? '[]')) } catch { setOrder([]) }
  }, [uid, saved])
  const save = useCallback((o: string[]) => {
    setOrder(o)
    if (uid) try { local.setItem(key(uid), JSON.stringify(o)) } catch { /* memory only */ }
    void supabase.rpc('set_tile_order', { p_order: o })
  }, [uid])
  return { order, save }
}

/** KPI first, then the saved order; tiles never arranged keep the company order after them. */
export function arrange<T extends { code: string }>(items: T[], order: string[]): T[] {
  const kpi = items.filter(m => m.code === 'kpi')
  const rest = items.filter(m => m.code !== 'kpi')
  const at = (c: string) => { const i = order.indexOf(c); return i < 0 ? Infinity : i }
  rest.sort((a, b) => at(a.code) - at(b.code) || items.indexOf(a) - items.indexOf(b))
  return [...kpi, ...rest]
}

const fixed = (c: string) => c === 'kpi'

type Pt = { x: number; y: number }
const centre = (el: HTMLElement): Pt => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }

/**
 * Phone: long press (450 ms). Mouse: a click waits 280 ms; a second press in that time, held, lifts the tile.
 * The lifted tile follows the pointer (CSS translate), the others slide to their new places (FLIP), and the jiggle
 * runs on CSS rotate so the two never fight.
 */
export function useArrange(codes: string[], onSave: (o: string[]) => void, grid: RefObject<HTMLElement | null>) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string[] | null>(null)
  const [lifted, setLifted] = useState<string | null>(null)
  const press = useRef<{ code: string; x: number; y: number; timer: number; moved: boolean } | null>(null)
  const pending = useRef<{ code: string; timer: number } | null>(null)
  const grab = useRef<Pt>({ x: 0, y: 0 })
  const pointer = useRef<Pt>({ x: 0, y: 0 })
  const before = useRef<Map<string, Pt>>(new Map())
  const suppress = useRef(false)
  const live = draft ?? codes

  const tileEl = (c: string) => grid.current?.querySelector<HTMLElement>(`[data-module="${c}"]`) ?? null
  const snapshot = () => {
    const m = new Map<string, Pt>()
    grid.current?.querySelectorAll<HTMLElement>('[data-module]').forEach(el => m.set(el.dataset.module!, centre(el)))
    before.current = m
  }
  const follow = (code: string) => {
    const el = tileEl(code); if (!el) return
    el.style.transition = 'none'; el.style.translate = ''
    const c = centre(el)
    el.style.translate = `${pointer.current.x - grab.current.x - c.x}px ${pointer.current.y - grab.current.y - c.y}px`
  }

  const begin = useCallback(() => { setEditing(true); setDraft(codes) }, [codes])
  const finish = useCallback((keep: boolean) => {
    if (keep && draft) onSave(draft.filter(c => !fixed(c)))
    grid.current?.querySelectorAll<HTMLElement>('[data-module]').forEach(el => { el.style.transition = ''; el.style.translate = '' })
    setEditing(false); setDraft(null); setLifted(null)
  }, [draft, onSave, grid])

  const lift = (code: string, el: HTMLElement, id: number, x: number, y: number) => {
    try { el.setPointerCapture(id) } catch { /* pointer already gone */ }
    const c = centre(el)
    grab.current = { x: x - c.x, y: y - c.y }; pointer.current = { x, y }
    setLifted(code)
  }

  useLayoutEffect(() => {
    if (!editing) return
    grid.current?.querySelectorAll<HTMLElement>('[data-module]').forEach(el => {
      const c = el.dataset.module!
      if (c === lifted) { follow(c); return }
      const was = before.current.get(c); if (!was) return
      el.style.transition = 'none'; el.style.translate = ''
      const now = centre(el)
      const dx = was.x - now.x, dy = was.y - now.y
      if (!dx && !dy) return
      el.style.translate = `${dx}px ${dy}px`
      void el.offsetWidth
      el.style.transition = 'translate 220ms cubic-bezier(.2,.8,.2,1)'
      el.style.translate = '0px 0px'
    })
    before.current = new Map()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.join(','), editing])

  const moveOver = (x: number, y: number) => {
    const from = lifted; if (!from) return
    const under = document.elementsFromPoint(x, y).map(e => e.closest<HTMLElement>('[data-module]')).find(e => e && e.dataset.module !== from)
    const to = under?.dataset.module
    if (!to || fixed(to)) return
    const a = [...live]; const i = a.indexOf(from), j = a.indexOf(to)
    if (i < 0 || j < 0 || i === j) return
    snapshot()
    a.splice(i, 1); a.splice(j, 0, from)
    setDraft(a)
  }

  const bind = (code: string, open: () => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      const mouse = e.pointerType === 'mouse'
      const p = { code, x: e.clientX, y: e.clientY, timer: 0, moved: false }
      press.current = p
      const el = e.currentTarget as HTMLElement
      if (editing) {
        if (fixed(code)) return
        e.preventDefault()
        lift(code, el, e.pointerId, e.clientX, e.clientY)
        return
      }
      if (mouse) {
        const q = pending.current
        if (q && q.code === code && !fixed(code)) {
          window.clearTimeout(q.timer); pending.current = null
          suppress.current = true; e.preventDefault()
          begin(); lift(code, el, e.pointerId, e.clientX, e.clientY)
        }
        return
      }
      const id = e.pointerId, x = e.clientX, y = e.clientY
      p.timer = window.setTimeout(() => {
        suppress.current = true
        navigator.vibrate?.(15)
        begin()
        if (!fixed(code)) lift(code, el, id, x, y)
      }, 450)
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const p = press.current; if (!p) return
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) p.moved = true
      if (!editing) { if (p.moved) { window.clearTimeout(p.timer); press.current = null } return }
      if (lifted !== code) return
      pointer.current = { x: e.clientX, y: e.clientY }
      follow(code)
      moveOver(e.clientX, e.clientY)
    },
    onPointerUp: () => {
      const p = press.current; press.current = null
      if (!p) return
      window.clearTimeout(p.timer)
      if (!editing) return
      if (lifted) {
        const el = tileEl(lifted)
        if (el) { el.style.transition = 'translate 200ms cubic-bezier(.2,.8,.2,1)'; el.style.translate = '0px 0px' }
        setLifted(null)
      }
      // A press without a move is the single click that ends arranging.
      if (!p.moved && !suppress.current) finish(true)
      suppress.current = false
    },
    onPointerCancel: () => { if (press.current) window.clearTimeout(press.current.timer); press.current = null; setLifted(null) },
    onClick: (e: React.MouseEvent) => {
      e.preventDefault()
      if (editing || suppress.current) return
      if (e.detail === 0 || (e.nativeEvent as PointerEvent).pointerType !== 'mouse') { open(); return }
      if (pending.current) return
      pending.current = { code, timer: window.setTimeout(() => { pending.current = null; open() }, 280) }
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
  })

  // A click anywhere off the tiles ends arranging and keeps it; Esc puts everything back.
  useEffect(() => {
    if (!editing) return
    const down = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest?.('.tiles [data-module]')) finish(true) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(false) }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', esc) }
  }, [editing, finish])

  useEffect(() => {
    if (!lifted) return
    const stop = (e: TouchEvent) => e.preventDefault()
    document.addEventListener('touchmove', stop, { passive: false })
    return () => document.removeEventListener('touchmove', stop)
  }, [lifted])

  return { editing, live, lifted, bind }
}
