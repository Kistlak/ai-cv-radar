import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export type RequireUserResult =
  | { user: User; supabase: SupabaseClient; response?: undefined }
  | { response: NextResponse; user?: undefined; supabase?: undefined }

// The one auth check for API route handlers: the signed-in user, or a ready
// 401 response. `headers` are added to the 401 (e.g. CORS headers).
//
//   const auth = await requireUser()
//   if (auth.response) return auth.response
//   const { user } = auth
export async function requireUser(headers?: HeadersInit): Promise<RequireUserResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers }) }
  }
  return { user, supabase }
}
