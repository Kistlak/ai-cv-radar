import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { cvs, type CV } from '@/db/schema'

// The user's current CV: the active one, or the newest if none is active.
// Upload keeps exactly one CV active, so today this is also the newest; every
// "which CV?" lookup goes through here so they can't drift apart.
export async function getActiveCv(userId: string): Promise<CV | undefined> {
  const [cv] = await db
    .select()
    .from(cvs)
    .where(eq(cvs.userId, userId))
    .orderBy(desc(cvs.isActive), desc(cvs.createdAt))
    .limit(1)
  return cv
}
