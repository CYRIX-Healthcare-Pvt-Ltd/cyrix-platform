import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Copy .env.example to .env.local and fill in the Supabase URL and key.')
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

/**
 * Employee codes are the login, but Supabase Auth needs an email, so
 * E1042 becomes e1042@cyrix.local. The address never receives anything —
 * it exists so the session is a real JWT and RLS has somebody to be.
 *
 * Identical to the mapping in the KPI app on purpose: the portal and the
 * modules share one project, so one person is one auth user across all
 * of them.
 */
const AUTH_DOMAIN = import.meta.env.VITE_AUTH_EMAIL_DOMAIN || 'cyrix.local'
export const ecodeToEmail = (ecode: string) =>
  `${ecode.trim().toLowerCase()}@${AUTH_DOMAIN}`

export interface Module {
  code: string
  name: string
  description: string | null
  path: string
  icon: string | null
  sort_order: number
  is_active: boolean
}
