import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * A sign-in on a second device (0149; the user, 8 Oct: "on 2nd login on
 * any other device, it should show that already signed in 1 device, send
 * otp to mail").
 *
 *   ok        in, as before
 *   pending   another device is signed in, and this one waits for its code
 *   revoked   this sign-in was ended — "sign out from all devices", from
 *             another device — and is signed out here too
 */
export type DeviceCheck =
  | { state: 'ok' }
  | { state: 'revoked' }
  | { state: 'pending'; others: number; email_hint: string | null }

export async function deviceCheck(): Promise<DeviceCheck> {
  const { data, error } = await supabase.rpc('device_check')
  if (error) throw error
  return data as DeviceCheck
}

/** Asked each minute, and on coming back to the page. */
export async function sessionState(): Promise<'ok' | 'pending' | 'revoked'> {
  const { data, error } = await supabase.rpc('my_session_state')
  if (error) throw error
  return data as 'ok' | 'pending' | 'revoked'
}

/** Which sign-in this is: the same through every token refresh. */
export function sessionIdOf(s: Session | null): string | null {
  if (!s) return null
  try {
    const part = s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return (JSON.parse(atob(part)) as { session_id?: string }).session_id ?? null
  } catch {
    return null
  }
}
