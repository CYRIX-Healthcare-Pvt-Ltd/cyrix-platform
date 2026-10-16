import { useEffect, useState, type CSSProperties } from 'react'
import onLight from './assets/cyrix-logo.png'
import onDark from './assets/cyrix-logo-white.png'
import { session } from './lib/storage'

/*
  Opening animation (the user, 15-16 Oct: "from X to our Cyrix"; "the X looks cropped"; "come from
  both sides and join, then go"; "make the X shine too"). The X is drawn in the app icon's shape,
  so nothing is ever cut off: its two halves fly in from either side and meet, large, in the
  middle; it zooms out onto the logo's own X while the rest of the wordmark opens out to its left;
  a wave of light sweeps the letters and then the X, and the splash fades into the app. Once per
  visit; ?splash shows it again. Skipped for reduced motion.
*/
const SEEN = 'cyra.splash'
// The app icon's symmetrical X, drawn in the logo artwork's pixels (300 x 115) to fill exactly the
// box of the logo's own X (rows 14-66), so it lands on it. Black's tip stays inside the red.
const BLACK = '223,14 236.5,14 257.25,35.58 257.25,44.42 236.5,66 223,66 248,40'
const RED = '286.5,14 273,14 248,40 273,66 286.5,66 261.5,40'

export default function Splash() {
  const forced = new URLSearchParams(window.location.search).has('splash')
  const [show, setShow] = useState(() => {
    if (forced) return true
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false } catch { /* old browser */ }
    return session.getItem(SEEN) !== '1'
  })
  useEffect(() => {
    if (!show) return
    session.setItem(SEEN, '1')
    /*
      Nothing under the splash may take focus while it plays (the user, 16 Oct: the browser's
      saved-password list opened over it, because the sign-in box focuses itself). Whatever tried
      is focused once the splash has gone.
    */
    let wanted: HTMLElement | null = null
    const hold = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null
      if (el && typeof el.blur === 'function') { wanted = el; el.blur() }
    }
    const active = document.activeElement as HTMLElement | null
    if (active && active !== document.body && typeof active.blur === 'function') { wanted = active; active.blur() }
    document.addEventListener('focusin', hold, true)
    const t = window.setTimeout(() => {
      document.removeEventListener('focusin', hold, true)
      setShow(false)
      if (wanted && document.contains(wanted)) window.setTimeout(() => wanted?.focus(), 50)
    }, 3000)
    return () => { window.clearTimeout(t); document.removeEventListener('focusin', hold, true) }
  }, [show])
  if (!show) return null
  const root = document.documentElement
  const dark = root.classList.contains('dark') || root.getAttribute('data-theme') === 'dark'
  const mask = { '--logo': `url(${dark ? onDark : onLight})` } as CSSProperties
  return (
    <div className="splash" aria-hidden="true">
      <div className="splash-mark" style={mask}>
        <img className="splash-logo on-light" src={onLight} alt="" />
        <img className="splash-logo on-dark" src={onDark} alt="" />
        {/* A wave of light across the letters only: the logo is its mask, like liquid glass. */}
        <span className="splash-shine" />
        {/* Drawn, starting large in the middle and landing on the logo's own X. */}
        <svg className="splash-x" viewBox="0 0 300 115">
          <defs>
            <clipPath id="splash-x-clip"><polygon points={BLACK} /><polygon points={RED} /></clipPath>
            <linearGradient id="splash-x-gloss" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Hides the logo's own X, a slightly different shape, so only this X is ever seen. */}
          <rect className="splash-x-cover" x="219" y="12" width="69.5" height="58" />
          <polygon className="splash-x-left" points={BLACK} />
          <polygon className="splash-x-right" points={RED} />
          {/* The same wave of light, carried on across the X once it has landed. */}
          <g clipPath="url(#splash-x-clip)">
            <rect className="splash-x-shine" x="180" y="0" width="34" height="115" fill="url(#splash-x-gloss)" />
          </g>
        </svg>
      </div>
    </div>
  )
}
