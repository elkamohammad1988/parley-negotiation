import { createClient } from '@supabase/supabase-js'

// .env.production.local (Vercel CLI pull) stores public vars as empty strings "".
// Guard with fallback so module evaluation doesn't throw during local builds;
// on Vercel the real values are always present at build time.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'parley-auth-session',
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
  }
)
