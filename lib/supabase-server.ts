import 'server-only' // a client import of the service-role key is a build error
import { createClient } from '@supabase/supabase-js'

// The service-role client. Every user-scoped table in this schema has RLS
// enabled with NO policies (see supabase_migrations.sql), so this key is the
// only thing that can read or write them — and the ownership checks in the
// route layer are therefore the only gate on that data.
//
// ── ABOUT THE FALLBACK CHAIN ────────────────────────────────────────────────
//
// Falling back to the anon key is safe in the sense that matters: with
// default-deny RLS the anon key can read nothing, so a deployment missing
// SUPABASE_SERVICE_ROLE_KEY fails CLOSED. It does not leak; it simply stops
// working. The fallback exists because `next build` evaluates route modules
// with no environment, and throwing here would break the build rather than the
// deployment.
//
// What was wrong with it was the silence. A production instance running on the
// anon key looks, from the outside, like a database outage: reads return
// nothing, every route's honest failure state renders, and nothing anywhere
// says which of the two it is. The warning below costs one log line at cold
// start and turns a confusing outage into a named misconfiguration.
//
// It is a warning and not a throw deliberately — see above — and the check is
// on NODE_ENV rather than on the key's absence alone, so local development and
// the test suite stay quiet.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'

if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[Supabase] SUPABASE_SERVICE_ROLE_KEY is not set. Every user-scoped table in ' +
      'this schema is RLS deny-by-default, so the server is falling back to a key ' +
      'that can read none of them: rehearsals, debriefs, playbook and billing ' +
      'reads will all return empty and every write will be refused. This is a ' +
      'configuration failure, not a database outage.'
  )
}

export const supabaseServer = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})
