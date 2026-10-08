import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildApplicationProfile } from '@/lib/application-profile'

// Comma-separated extension origins (e.g. chrome-extension://<id>) allowed to read
// the profile cross-origin. Our own extension normally doesn't need this: its
// service worker has host permissions, which exempts it from CORS.
const ALLOWED_EXTENSION_ORIGINS = (process.env.ALLOWED_EXTENSION_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_EXTENSION_ORIGINS.includes(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function GET(req: NextRequest) {
  const headers = corsHeaders(req.headers.get('origin'))

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  const result = await buildApplicationProfile(user.id, user.email ?? null)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status, headers })
  }

  return NextResponse.json({ profile: result.profile }, { headers })
}
