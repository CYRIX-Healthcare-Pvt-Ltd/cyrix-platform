import { useEffect, useState, type CSSProperties } from 'react'
import onLight from './assets/cyrix-logo.png'
import onDark from './assets/cyrix-logo-white.png'
import { session } from './lib/storage'

/*
  Opening animation (the user, 15-16 Oct: "from X to our Cyrix"; "the X looks cropped"; then "the X
  should zoom out and fit in where CYRIX shows, liquid glass letters, little shine lights at the
  edge"). The X is drawn in the app icon's shape, so nothing is ever cut off: its two halves slide
  in and meet, large, in the middle; it zooms out onto the logo's own X while the rest of the
  wordmark opens out to its left; a band of light sweeps the letters, glints twinkle at the edges,
  and the splash fades into the app. Once per visit; ?splash shows it again. Skipped for reduced
  motion.
*/
const SEEN = 'cyra.splash'
// The app icon's symmetrical X (the user wants both halves alike), drawn in the logo artwork's
// pixels (300 x 115) to fill exactly the box of the logo's own X, so it lands on it. Black's tip
// stays inside the red.
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
    const t = window.setTimeout(() => setShow(false), 3000)
    return () => window.clearTimeout(t)
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
        {/* A band of light across the letters only: the logo is its mask, like liquid glass. */}
        <span className="splash-shine" />
        {/* Drawn, starting large in the middle and landing on the logo's own X. */}
        <svg className="splash-x" viewBox="0 0 300 115">
          {/* Hides the logo's own X, a slightly different shape, so only this X is ever seen (the user, 16 Oct). */}
          <rect className="splash-x-cover" x="219" y="12" width="69.5" height="58" />
          <polygon className="splash-x-left" points={BLACK} />
          <polygon className="splash-x-right" points={RED} />
        </svg>
      </div>
    </div>
  )
}
