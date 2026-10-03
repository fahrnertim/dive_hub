// The dive history, kept short (UI review C2): edits one person makes in a row are one entry.

export interface Revision {
  id: string;
  at: string;
  actor: { type: string; id: string; name: string | null };
  cause: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

/** Edits by the same person no further apart than this are merged. */
const MERGE_WITHIN_MS = 10 * 60 * 1000;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merges consecutive edits (newest first, as the API lists them) by the same person within ten
 * minutes: each field goes from its first `from` to its last `to`; a field changed and changed back
 * drops out. `count` says how many edits an entry stands for.
 */
export function mergeEdits<R extends Revision>(revisions: R[]): (R & { count: number })[] {
  const out: (R & { count: number })[] = [];
  for (const r of revisions) {
    const newer = out.at(-1);
    const mergeable = newer && newer.cause === 'edit' && r.cause === 'edit'
      && newer.actor.type === r.actor.type && newer.actor.id === r.actor.id
      && Date.parse(newer.at) - Date.parse(r.at) <= MERGE_WITHIN_MS;
    if (!mergeable) {
      out.push({ ...r, count: 1 });
      continue;
    }
    const changes: Record<string, { from: unknown; to: unknown }> = { ...r.changes };
    for (const [key, change] of Object.entries(newer.changes)) {
      changes[key] = { from: key in r.changes ? r.changes[key]!.from : change.from, to: change.to };
    }
    for (const [key, change] of Object.entries(changes)) if (key !== 'overrides' && same(change.from, change.to)) delete changes[key];
    out[out.length - 1] = { ...newer, changes, count: newer.count + 1 };
  }
  return out;
}
