// A Dive's number (ADR 0048): its place by start time among its Diver's Dives that count, plus the Diver's "dives
// before this logbook". Computed, never typed; kept in `dive.number` by this one module so that the list's search and
// sort and every view that names a Dive read a column.
import { sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';

/**
 * Numbers Dives: a Dive counts when it isn't deleted and, if it is an apnea session (its Primary recording's dive
 * mode), when its Diver counts those. Two Dives at one instant are ordered by their ids. Only a number that differs
 * is written, and no `version`, no `updated_at` and no Revision: renumbering is not a change of the Dive.
 */
const renumberStatement = (diverIds: string[]) => sql`
  with numbered as (
    select d.id,
           case when d.deleted_at is null and (dv.apnea_counts or coalesce(r.summary->>'diveMode', '') <> 'apnea')
             then dv.dives_before + row_number() over (
               partition by d.diver_id,
                 (d.deleted_at is null and (dv.apnea_counts or coalesce(r.summary->>'diveMode', '') <> 'apnea'))
               order by d.starts_at, d.id)
           end as n
    from dive d
    join diver dv on dv.id = d.diver_id
    left join recording r on r.id = d.primary_recording_id
    where d.diver_id in (${sql.join(diverIds.map((id) => sql`${id}::uuid`), sql`, `)})
  )
  update dive d set number = numbered.n from numbered
  where d.id = numbered.id and d.number is distinct from numbered.n`;

/**
 * Numbers these Divers' Dives again. Callers say "these Divers' Dives changed" and nothing else; call it as the last
 * statement on Dives of the transaction that made the change. Two renumberings of one Diver wait for each other (a lock
 * on the Diver's row that doesn't hold up inserts of Dives), so the second sees what the first wrote.
 */
export async function renumber(tx: Tx, diverIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(diverIds)].sort();
  if (ids.length === 0) return;
  await tx.execute(sql`select id from diver where id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) order by id for no key update`);
  await tx.execute(renumberStatement(ids));
}
