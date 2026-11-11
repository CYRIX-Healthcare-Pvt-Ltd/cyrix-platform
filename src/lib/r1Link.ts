/**
 * The Rank 1 notification's links (KPI 0281): /?r1=list opens the Rank 1s list, /?r1=photo opens the profile card
 * to add a photo. Read once, then taken out of the address so a reload does not open it again.
 */
const at = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('r1')
let used = false
export function takeR1(want: 'list' | 'photo'): boolean {
  if (used || at !== want) return false
  used = true
  const u = new URL(window.location.href); u.searchParams.delete('r1')
  window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
  return true
}
