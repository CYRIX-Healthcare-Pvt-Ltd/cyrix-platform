/**
 * Somebody's face, or their initials.
 *
 * The same component every module has, because it is the same photograph:
 * a base64 data URL on the employee row that HR maintains, so it arrives
 * with the name that was being fetched anyway and there is nothing to
 * load. Initials stay the fallback rather than a grey silhouette — an
 * outline of a person reads as "unknown", and we know exactly who this is.
 */
export function initialsOf(name: string | null | undefined): string {
  return (name ?? '?')
    .trim().split(/\s+/).slice(0, 2)
    .map(p => p[0] ?? '')
    .join('')
    .toUpperCase() || '?'
}

export default function Avatar({
  name, src, className = '',
}: {
  name: string | null | undefined
  src?: string | null
  className?: string
}) {
  if (src) {
    return (
      <img
        src={src}
        // The name is on screen beside this, so repeating it here would
        // have a screen reader say it twice.
        alt=""
        className={`user-avatar ${className}`}
        loading="lazy"
        draggable={false}
      />
    )
  }

  return (
    <span className={`user-avatar user-avatar-initials ${className}`} aria-hidden>
      {initialsOf(name)}
    </span>
  )
}
