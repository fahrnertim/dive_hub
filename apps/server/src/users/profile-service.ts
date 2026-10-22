// A User's own Diver and display preferences (ADR 0053): the routes pass the User's id and hold no query.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { diver, diverManagement, userPreference } from '../db/schema.js';

type Preferences = Partial<Pick<typeof userPreference.$inferInsert, 'language' | 'units'>>;

export function createProfileService(db: Db) {
  return {
    read: async (userId: string) => {
      const [own] = await db.select({ id: diver.id, name: diver.name }).from(diverManagement)
        .innerJoin(diver, eq(diver.id, diverManagement.diverId))
        .where(and(eq(diverManagement.userId, userId), eq(diverManagement.isOwn, true)));
      const [prefs] = await db.select().from(userPreference).where(eq(userPreference.userId, userId));
      return { ownDiver: own!, preferences: { language: prefs?.language ?? null, units: prefs?.units ?? null } };
    },
    savePreferences: async (userId: string, input: Preferences) => {
      const changes = { ...input, updatedAt: new Date() };
      const [saved] = await db.insert(userPreference).values({ userId, ...changes })
        .onConflictDoUpdate({ target: userPreference.userId, set: changes }).returning();
      return { language: saved!.language, units: saved!.units };
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
