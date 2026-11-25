/**
 * The portal's header mark: the "Cyra." wordmark from the opening splash, with
 * "by Cyrix" set small beside it (the user, 25 Nov: "instead of Cyrix logo,
 * place Cyra logo or typography logo, elegantly"). The same paths as the splash
 * in index.html, so the bar and the splash it follows are one drawing.
 *
 * Letters take `currentColor` (the bar's ink, so it follows the theme); the
 * full stop is the brand red in both themes, as on the splash. The Cyrix
 * wordmark is the same PNG pair the splash uses; CSS shows the one for the
 * theme, in the same frame as the theme switch (see .cyrix-logo in index.css).
 */
export default function CyraMark() {
  return (
    <span className="cyra-mark" role="img" aria-label="Cyra by Cyrix">
      <svg className="cyra-word" viewBox="5 -71.4 257 72.8" aria-hidden="true">
        <path d="M33.2 1.4L33.2 1.4Q20.2 1.4 12.6-5.9Q5-13.1 5-26.6L5-26.6L5-43.4Q5-56.9 12.6-64.2Q20.2-71.4 33.2-71.4L33.2-71.4Q46.1-71.4 53.2-64.4Q60.2-57.3 60.2-45L60.2-45L60.2-44.4L47.2-44.4L47.2-45.4Q47.2-51.6 43.8-55.6Q40.3-59.6 33.2-59.6L33.2-59.6Q26.2-59.6 22.2-55.3Q18.2-51 18.2-43.6L18.2-43.6L18.2-26.4Q18.2-19.1 22.2-14.8Q26.2-10.4 33.2-10.4L33.2-10.4Q40.3-10.4 43.8-14.5Q47.2-18.5 47.2-24.6L47.2-24.6L47.2-26.4L60.2-26.4L60.2-25Q60.2-12.7 53.2-5.7Q46.1 1.4 33.2 1.4Z" />
        <path d="M98.2 0L85 0L85-24.1L61.2-70L75.9-70L90.7-40L92.5-40L107.3-70L122-70L98.2-24.1L98.2 0Z" />
        <path d="M138.6 0L125.4 0L125.4-70L155.8-70Q162.4-70 167.3-67.7Q172.2-65.4 174.9-61.2Q177.6-57 177.6-51.3L177.6-51.3L177.6-50.1Q177.6-43.8 174.6-39.9Q171.6-36 167.2-34.2L167.2-34.2L167.2-32.4Q171.2-32.2 173.4-29.7Q175.6-27.1 175.6-22.9L175.6-22.9L175.6 0L162.4 0L162.4-21Q162.4-23.4 161.2-24.9Q159.9-26.4 157-26.4L157-26.4L138.6-26.4L138.6 0ZM138.6-58L138.6-38.4L154.4-38.4Q159.1-38.4 161.8-41.0Q164.4-43.5 164.4-47.7L164.4-47.7L164.4-48.7Q164.4-52.9 161.8-55.5Q159.2-58 154.4-58L154.4-58L138.6-58Z" />
        <path d="M193.4 0L179.8 0L198.2-70L221.2-70L239.6 0L226 0L222.2-15.4L197.2-15.4L193.4 0ZM208.8-61.7L200.3-27.6L219.1-27.6L210.6-61.7L208.8-61.7Z" />
        <path className="cyra-dot" d="M252.4 1.4L252.4 1.4Q248.3 1.4 245.6-1.3Q242.8-3.9 242.8-8.1L242.8-8.1Q242.8-12.3 245.6-15.0Q248.3-17.6 252.4-17.6L252.4-17.6Q256.4-17.6 259.1-15.0Q261.8-12.3 261.8-8.1L261.8-8.1Q261.8-3.9 259.1-1.3Q256.4 1.4 252.4 1.4Z" />
      </svg>
      <span className="cyra-by" aria-hidden="true">
        <span>by</span>
        <img className="cyrix-logo-light" src="/brand/cyrix-wordmark.png" alt="" />
        <img className="cyrix-logo-dark" src="/brand/cyrix-wordmark-white.png" alt="" />
      </span>
    </span>
  )
}
