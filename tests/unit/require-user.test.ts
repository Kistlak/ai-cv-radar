import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ user: null as null | { id: string } }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}))

import { requireUser } from '@/lib/auth'

describe('requireUser', () => {
  it('returns a 401 response when nobody is signed in', async () => {
    state.user = null
    const auth = await requireUser()
    expect(auth.user).toBeUndefined()
    expect(auth.response?.status).toBe(401)
    expect(await auth.response?.json()).toEqual({ error: 'Unauthorized' })
  })

  it('adds the given headers to the 401 (e.g. CORS)', async () => {
    state.user = null
    const auth = await requireUser({ 'Access-Control-Allow-Origin': 'chrome-extension://abc' })
    expect(auth.response?.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abc')
  })

  it('returns the user and client when signed in', async () => {
    state.user = { id: 'user-1' }
    const auth = await requireUser()
    expect(auth.response).toBeUndefined()
    expect(auth.user?.id).toBe('user-1')
    expect(auth.supabase).toBeDefined()
  })
})
