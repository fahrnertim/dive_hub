// The buddy row SSI's app sends with `save_buddy` (`Buddy.toJson`, docs/research/2026-10-27-ssi-buddy-checks.md). Flags go
// as numbers 0/1: that is how SSI keeps and returns them. Nothing here leaves `providers/ssi/`.

/** The keys of the app's buddy row, in its order. */
export const BUDDY_KEYS = [
  'id', 'localRefId', 'address', 'dob', 'comment', 'added', 'email', 'firstname', 'gender', 'image', 'lastname', 'leader_nr',
  'leader_active', 'master_id', 'nickname', 'phone', 'deleted', 'needsUpload', 'confirmed', 'favorite',
] as const;

/** An entry as SSI returned it, or a new one, with exactly the app's keys. */
export type SsiBuddyRow = Record<(typeof BUDDY_KEYS)[number], unknown>;

const FLAGS = ['leader_active', 'deleted', 'needsUpload', 'confirmed', 'favorite'] as const;

/** An SSI account as the number SSI keeps in `master_id`; null without one. */
const accountNumber = (account: string | null) => (account !== null && /^[1-9]\d*$/.test(account) ? Number(account) : null);

/** A new entry from scratch, as the app sends it: the name and e-mail given, flags 0 except `needsUpload`, the rest null. */
export function newEntryRow(person: { firstName: string | null; lastName: string | null; email: string | null; account: string | null }): SsiBuddyRow {
  const row = Object.fromEntries(BUDDY_KEYS.map((key) => [key, null])) as SsiBuddyRow;
  for (const flag of FLAGS) row[flag] = 0;
  row.needsUpload = 1;
  row.firstname = person.firstName;
  row.lastname = person.lastName;
  row.email = person.email ?? '';
  row.master_id = accountNumber(person.account);
  return row;
}

/**
 * A new entry for a person with an SSI account: the account and the flags, nothing else. SSI answers a create with an
 * account already in the list by that entry and writes every key sent onto it, empty ones too (check step 8), so no
 * name, date or contact key goes along; SSI fills the entry from the person's profile.
 */
export function accountOnlyRow(account: string) {
  return { id: null, master_id: accountNumber(account), leader_active: 0, deleted: 0, needsUpload: 1, confirmed: 0, favorite: 0 };
}

/** An existing entry saved back as SSI returned it, with the account set (SSI then fills the name from the profile). */
export function withAccountRow(entry: SsiBuddyRow, account: string): SsiBuddyRow {
  return { ...entry, master_id: accountNumber(account), needsUpload: 1 };
}

/** The app's keys of an entry SSI returned; a key it left out is null. */
export function rowOf(entry: Record<string, unknown>): SsiBuddyRow {
  return Object.fromEntries(BUDDY_KEYS.map((key) => [key, entry[key] ?? null])) as SsiBuddyRow;
}
