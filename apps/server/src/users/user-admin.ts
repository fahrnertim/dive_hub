// What admins can do to Users (ADR 0013): change role, disable/enable, end sessions, delete.
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { original, session, user } from '../db/schema.js';
import type { BlobStore } from '../storage/blob-store.js';
import { PROBLEMS } from '../http/problems.js';
import type { Role } from './invitations.js';

export class UserAdminError extends Error {
  constructor(readonly code: 'user_not_found' | 'last_admin' | 'not_yourself' | 'confirmation_mismatch') {
    super(PROBLEMS[code]);
  }
}

type UserRow = typeof user.$inferSelect;

export function createUserAdmin(db: Db, blobs: BlobStore) {
  /**
   * Locks the target and every enabled admin row for the rest of the transaction, so two admins
   * can't demote or remove each other at the same moment and leave the instance without one.
   */
  async function lock(tx: Tx, userId: string): Promise<{ target: UserRow; otherAdmins: number }> {
    const rows = await tx.select().from(user)
      .where(sql`${user.id} = ${userId} or (${user.role} = 'admin' and ${user.banned} is not true)`)
      .orderBy(user.id).for('update');
    const target = rows.find((r) => r.id === userId);
    if (!target) throw new UserAdminError('user_not_found');
    const otherAdmins = rows.filter((r) => r.id !== userId && r.role === 'admin' && !r.banned).length;
    return { target, otherAdmins };
  }

  /** Throws unless the change still leaves an enabled admin. */
  function keepAnAdmin(target: UserRow, otherAdmins: number) {
    if (target.role === 'admin' && !target.banned && otherAdmins === 0) {
      throw new UserAdminError('last_admin');
    }
  }

  const notSelf = (targetId: string, actorId: string) => {
    if (targetId === actorId) throw new UserAdminError('not_yourself');
  };

  return {
    async setRole(userId: string, role: Role): Promise<UserRow> {
      return db.transaction(async (tx) => {
        const { target, otherAdmins } = await lock(tx, userId);
        if (role !== 'admin') keepAnAdmin(target, otherAdmins);
        const [updated] = await tx.update(user).set({ role, updatedAt: new Date() }).where(eq(user.id, userId)).returning();
        return updated!;
      });
    },

    /** Blocks sign-in and ends every session; all data stays. */
    async disable(userId: string, actorId: string): Promise<UserRow> {
      notSelf(userId, actorId);
      return db.transaction(async (tx) => {
        const { target, otherAdmins } = await lock(tx, userId);
        keepAnAdmin(target, otherAdmins);
        const [updated] = await tx.update(user).set({ banned: true, banReason: null, banExpires: null, updatedAt: new Date() })
          .where(eq(user.id, userId)).returning();
        await tx.delete(session).where(eq(session.userId, userId));
        return updated!;
      });
    },

    async enable(userId: string): Promise<UserRow> {
      const [updated] = await db.update(user).set({ banned: false, updatedAt: new Date() }).where(eq(user.id, userId)).returning();
      if (!updated) throw new UserAdminError('user_not_found');
      return updated;
    },

    /** Signs the User out everywhere. */
    async endSessions(userId: string): Promise<void> {
      const [found] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
      if (!found) throw new UserAdminError('user_not_found');
      await db.delete(session).where(eq(session.userId, userId));
    },

    /**
     * Deletes the account and everything only this User owns: their Originals (and the stored files
     * no other User's Original shares), Imports, and the Divers no one else manages, with their Dives,
     * Recordings, samples, Devices and Revisions. The admin confirms by typing the User's e-mail.
     */
    async remove(userId: string, actorId: string, confirmEmail: string): Promise<void> {
      notSelf(userId, actorId);
      const fileKeys = await db.transaction(async (tx) => {
        const { target, otherAdmins } = await lock(tx, userId);
        if (confirmEmail.trim().toLowerCase() !== target.email) {
          throw new UserAdminError('confirmation_mismatch');
        }
        keepAnAdmin(target, otherAdmins);
        return deleteUserData(tx, userId);
      });
      // Files go after the commit: a failed transaction must not lose files that are still referenced.
      const stillUsed = new Set(fileKeys.originals.length === 0 ? [] : (await db.select({ key: original.storageKey })
        .from(original).where(inArray(original.storageKey, fileKeys.originals))).map((r) => r.key));
      for (const key of [...fileKeys.originals.filter((k) => !stillUsed.has(k)), ...fileKeys.uploads]) await blobs.delete(key);
    },
  };
}

/** Deletes the rows; returns storage keys of the removed Originals and of unprocessed uploads. */
async function deleteUserData(tx: Tx, userId: string) {
  const rows = <T>(query: ReturnType<typeof sql>) => tx.execute(query).then((r) => r.rows as T[]);
  // Divers only this User manages, and the Recordings delivered by this User's Imports.
  await tx.execute(sql`create temp table doomed_diver on commit drop as
    select diver_id as id from diver_management dm where dm.user_id = ${userId}
      and not exists (select 1 from diver_management o where o.diver_id = dm.diver_id and o.user_id <> ${userId})`);
  await tx.execute(sql`create temp table doomed_dive on commit drop as
    select id from dive where diver_id in (select id from doomed_diver)`);
  await tx.execute(sql`create temp table doomed_recording on commit drop as
    select id from recording where import_id in (select id from import where user_id = ${userId})
       or dive_id in (select id from doomed_dive)`);

  await tx.execute(sql`delete from revision where entity_id in (select id from doomed_recording)
    or entity_id in (select id from doomed_dive) or entity_id in (select id from doomed_diver)`);
  await tx.execute(sql`delete from duplicate_candidate where recording_id in (select id from doomed_recording)`);
  // A surviving Dive (of a Diver someone else also manages) loses its Primary recording if it was one of these.
  await tx.execute(sql`update dive set primary_recording_id = null where primary_recording_id in (select id from doomed_recording)`);
  await tx.execute(sql`delete from recording where id in (select id from doomed_recording)`); // samples, events cascade
  // Pushes record what reached a Target (ADR 0024); they go with their Dive. The User's Connections hold
  // their secrets for Targets, and a doomed Diver's External IDs go with the Diver.
  await tx.execute(sql`delete from push where dive_id in (select id from doomed_dive)`);
  await tx.execute(sql`delete from connection where user_id = ${userId}`);
  await tx.execute(sql`delete from diver_external_id where diver_id in (select id from doomed_diver)`);
  await tx.execute(sql`delete from dive where id in (select id from doomed_dive)`);
  await tx.execute(sql`update recording set device_id = null where device_id in (select id from device where diver_id in (select id from doomed_diver))`);
  await tx.execute(sql`delete from device where diver_id in (select id from doomed_diver)`);
  await tx.execute(sql`delete from diver_management where user_id = ${userId}`);
  await tx.execute(sql`delete from diver where id in (select id from doomed_diver)`);

  // Originals belong to one User (per-User dedup), so all of theirs go.
  await tx.execute(sql`delete from import_original where import_id in (select id from import where user_id = ${userId})`);
  const originals = (await rows<{ storage_key: string }>(sql`delete from original where user_id = ${userId}
    returning storage_key`)).map((r) => r.storage_key);
  const uploads = (await rows<{ upload_storage_key: string | null }>(sql`delete from import where user_id = ${userId}
    returning upload_storage_key`)).flatMap((r) => (r.upload_storage_key ? [r.upload_storage_key] : []));
  // Sessions, credentials, invitations and reset links cascade with the user row.
  await tx.delete(user).where(eq(user.id, userId));
  return { originals, uploads };
}

export type UserAdmin = ReturnType<typeof createUserAdmin>;
