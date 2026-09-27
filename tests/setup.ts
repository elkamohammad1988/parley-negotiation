// Environment for the test run.
//
// Set before any module is imported, because lib/supabase-server.ts and
// lib/site-url.ts read process.env at module scope. These are deliberately
// obvious fakes: a test that somehow reaches the network should fail loudly
// rather than quietly hitting a real project.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://test.supabase.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.NEXT_PUBLIC_SITE_URL ||= 'http://localhost:3000'
