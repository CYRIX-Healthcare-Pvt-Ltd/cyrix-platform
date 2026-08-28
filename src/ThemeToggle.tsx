import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Sun, Moon } from 'lucide-react'
import {
  type Theme, readTheme, setTheme, nextTheme, resolveTheme, THEME_KEY,
} from './lib/theme'

/**
 * The same switch as every module, reading and writing the same key.
 *
 * Plain CSS rather than the modules' utility classes, because the portal
 * has no Tailwind — but the behaviour and the motion are identical, which
 * is the part anybody notices.
 */
export default function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(() => readTheme())

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) setLocal(readTheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    const next = nextTheme(theme)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = (document as Document & {
      startViewTransition?: (cb: () => void) => void
    }).startViewTransition

    const commit = () => { setTheme(next); setLocal(next) }

    if (reduced || typeof start !== 'function') {
      commit()
      return
    }

    const x = event.clientX
    const y = event.clientY
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    )
    const root = document.documentElement
    root.style.setProperty('--theme-x', `${x}px`)
    root.style.setProperty('--theme-y', `${y}px`)
    root.style.setProperty('--theme-r', `${radius}px`)

    // startViewTransition snapshots when its callback returns, so the
    // state has to have landed by then.
    start.call(document, () => { flushSync(commit) })
  }

  const dark = resolveTheme(theme) === 'dark'
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <button type="button" className="icon-btn theme-btn" onClick={toggle} title={label}>
      <Sun size={17} className={`theme-icon${dark ? ' is-on' : ''}`} />
      <Moon size={17} className={`theme-icon moon${dark ? '' : ' is-on'}`} />
      <span className="sr">{label}</span>
    </button>
  )
}
