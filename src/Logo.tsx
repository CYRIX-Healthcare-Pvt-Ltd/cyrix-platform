/**
 * The Cyrix Healthcare lockup, identical in every module.
 *
 * BEMMP's drawing, ported verbatim: it is the one measured against the
 * printed artwork. Each app previously approximated the same wordmark in
 * its own HTML, which is how one company came to have four that are nearly
 * but not quite alike — the ® landed somewhere different in each. The
 * coordinates are the lockup and are not adjusted here; only `height`
 * changes between call sites.
 *
 * SVG text rather than an image, so the dark half follows `currentColor`
 * and flips with the theme while the red stays the brand red in both.
 */
export default function Logo({
  height = 34,
  subtitle = true,
  className = '',
}: {
  height?: number
  subtitle?: boolean
  className?: string
}) {
  // The full lockup is 78 units tall; the wordmark alone is 52.
  const box = subtitle ? 78 : 52

  return (
    <svg
      viewBox={`0 0 300 ${box}`}
      height={height}
      className={className}
      role="img"
      aria-label="Cyrix Health Care Pvt Ltd"
    >
      <text
        x="0" y="44"
        fontSize="52" fontWeight="700" letterSpacing="1"
        fill="currentColor"
        fontFamily="inherit"
      >
        CYRI<tspan fill="#e30613">X</tspan>
      </text>
      <text
        x="171" y="16"
        fontSize="13" fontWeight="600"
        fill="#e30613"
        fontFamily="inherit"
      >
        ®
      </text>
      {subtitle && (
        <text
          x="1" y="66"
          fontSize="13.5" fontWeight="500" letterSpacing="3.4"
          fill="currentColor"
          fontFamily="inherit"
        >
          HEALTH CARE PVT LTD
        </text>
      )}
    </svg>
  )
}
