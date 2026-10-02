import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { diver, diverManagement } from './db/schema.js';

/**
 * Until sign-in exists (ADR 0011, next slice), the app runs as one development user.
 * This ensures that user has an own Diver, so imports have somewhere to go.
 */
export const DEV_USER_ID = 'dev';

export async function ensureDevUser(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    const [own] = await tx.select().from(diverManagement)
      .where(and(eq(diverManagement.userId, DEV_USER_ID), eq(diverManagement.isOwn, true)));
    if (own) return;
    const [me] = await tx.insert(diver).values({ name: 'Me' }).returning();
    await tx.insert(diverManagement).values({ userId: DEV_USER_ID, diverId: me!.id, isOwn: true });
  });
}
