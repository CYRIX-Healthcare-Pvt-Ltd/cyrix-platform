import { supabase } from './supabase'

/**
 * Talking to the password-otp edge function.
 *
 * Thin on purpose: every decision that matters — whether a code may be
 * issued, whether one is right, what a stranger is told — is made on the
 * server. Nothing here is a check; it is a phone line.
 *
 * The function is shared by all four deployments and always was. What
 * moved to the portal is the screen, not the machinery: recovery belongs
 * at the front door, because somebody locked out of their account is
 * locked out of every module and should not have to guess which one to
 * ask. Only the reset half is here — changing a password while signed in
 * happens inside KPI, which owns the employee record.
 */

export interface OtpReply {
  ok: boolean
  message: string
}

/**
 * The token this request travels with.
 *
 * Nobody is signed in during a reset, which is most of the point, so it
 * is the publishable key — which is what the gateway wants in front of a
 * function that verifies JWTs.
 *
 * Set here rather than left to functions.invoke, which stopped attaching
 * it at all once the project moved to sb_publishable keys. The gateway
 * then refused every anonymous call with UNAUTHORIZED_NO_AUTH_HEADER
 * before the function ran, so the whole forgot-password flow answered a
 * spinner that never stopped — while the same call with the header set
 * worked perfectly, which is exactly the shape of bug that survives
 * testing from a terminal.
 */
async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  return `Bearer ${token}`
}

async function call(body: Record<string, unknown>): Promise<OtpReply> {
  const { data, error } = await supabase.functions.invoke('password-otp', {
    body,
    headers: { Authorization: await authHeader() },
  })

  // A non-2xx comes back as an error with the body on the context, and
  // the body is where the sentence written for the reader lives.
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const said = await ctx.json()
        if (said?.error) return { ok: false, message: String(said.error) }
      } catch { /* not JSON; fall through to the generic */ }
    }
    return {
      ok: false,
      message: error.message?.includes('Failed to send')
        ? 'Could not reach the server. Check your connection.'
        : 'Something went wrong. Try again shortly.',
    }
  }

  const said = data as { ok?: boolean; message?: string; error?: string }
  if (said?.error) return { ok: false, message: said.error }
  return { ok: !!said?.ok, message: said?.message ?? '' }
}

/**
 * Send a code to the address on this person's record.
 *
 * The email is what the person typed, not what we hold — the server
 * compares the two and refuses if they differ. Passing our own copy
 * would make the field decoration.
 */
export const requestOtp = (args: { ecode: string; email: string }): Promise<OtpReply> =>
  call({ action: 'request', purpose: 'reset', ecode: args.ecode, email: args.email })

/** Hand back the code and the new password. One round trip, one answer. */
export const submitOtp = (args: {
  ecode: string
  code: string
  password: string
}): Promise<OtpReply> =>
  call({
    action: 'submit',
    purpose: 'reset',
    ecode: args.ecode,
    code: args.code,
    password: args.password,
  })
