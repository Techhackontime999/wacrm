import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy singleton service-role client for server-side admin work.
// Shared across automations, flows, webhooks, and API routes so the
// pattern cannot drift between call sites.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
