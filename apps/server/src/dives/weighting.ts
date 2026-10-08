// Lead, weighting feedback and the exposure suit of a Dive (ADR 0031): the Dive's own values. Lead is set as one
// list of placed entries: no entries means unknown, one entry of 0 means no lead.
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { dive, lead, revision, type LeadPlacement, type SuitType, type SuitUndergarment, type WeightingFelt } from '../db/schema.js';
import type { Changes } from './revisions.js';

export interface LeadEntry {
  amountKg: number;
  /** Where it was carried; null when not given. */
  placement: LeadPlacement | null;
}

export type LeadInput = Pick<LeadEntry, 'amountKg'> & Partial<LeadEntry>;

/** A Dive's Lead entries in their order. */
export async function leadOf(tx: Tx | Db, diveId: string): Promise<LeadEntry[]> {
  const rows = await tx.select().from(lead).where(eq(lead.diveId, diveId)).orderBy(asc(lead.position));
  return rows.map((r) => ({ amountKg: r.amountKg, placement: r.placement }));
}

/** The total of the entries in kg, or null when there are none (unknown). */
export const leadTotalKg = (entries: readonly LeadEntry[]): number | null =>
  (entries.length === 0 ? null : Math.round(entries.reduce((sum, e) => sum + e.amountKg, 0) * 100) / 100);

async function write(tx: Tx, diveId: string, list: LeadEntry[]) {
  await tx.delete(lead).where(eq(lead.diveId, diveId));
  if (list.length === 0) return;
  await tx.insert(lead).values(list.map((e, position) => ({ diveId, position, amountKg: e.amountKg, placement: e.placement })));
}

/**
 * Replaces the Dive's Lead entries with `list` and answers the change for the Dive's Revision (empty when nothing
 * differs). The caller holds the Dive's lock, raises its version and writes the Revision.
 */
export async function setLead(tx: Tx, diveId: string, list: LeadInput[]): Promise<Changes> {
  const before = await leadOf(tx, diveId);
  const next: LeadEntry[] = list.map((e) => ({ amountKg: e.amountKg, placement: e.placement ?? null }));
  if (JSON.stringify(before) === JSON.stringify(next)) return {};
  await write(tx, diveId, next);
  return { lead: { from: before, to: next } };
}

/**
 * The weight typed at a Provider, in kg, as the Dive's Lead (ADR 0031). `fill`: a Dive without entries gets one, without
 * a placement, unless its history spoke of Lead (one a User emptied stays empty); a Dive with entries keeps them.
 * `take`: the Dive's only entry takes the total and keeps its placement, a Dive without entries gets one. With several
 * entries nothing: the total can't be told to be one of them. Answers the change for the caller's Revision.
 */
export async function mergeProviderLead(tx: Tx, diveId: string, kg: number, how: 'fill' | 'take'): Promise<Changes> {
  const before = await leadOf(tx, diveId);
  if (before.length > 1 || (before.length === 1 && how === 'fill')) return {};
  if (before.length === 0 && how === 'fill') {
    const [spoken] = await tx.select({ id: revision.id }).from(revision)
      .where(and(eq(revision.entityType, 'dive'), eq(revision.entityId, diveId), sql`jsonb_exists(${revision.changes}, 'lead')`)).limit(1);
    if (spoken) return {};
  }
  return setLead(tx, diveId, [{ amountKg: kg, placement: before[0]?.placement ?? null }]);
}

export class WeightingError extends Error {
  constructor(readonly code: 'weighting_feedback_invalid' | 'suit_invalid') {
    super(code);
  }
}

type DiveRow = typeof dive.$inferSelect;

/** How the weighting felt on a Dive, with by how much where the User said (ADR 0031). */
export interface WeightingFeedback {
  felt: WeightingFelt;
  amountKg: number | null;
}
export type WeightingFeedbackInput = Pick<WeightingFeedback, 'felt'> & Partial<WeightingFeedback>;

export const weightingFeedbackOf = (row: Pick<DiveRow, 'weightingFelt' | 'weightingAmountKg'>): WeightingFeedback | null =>
  (row.weightingFelt ? { felt: row.weightingFelt, amountKg: row.weightingAmountKg } : null);

/**
 * Sets or takes away the Dive's weighting feedback and answers the change for the Dive's Revision (empty when nothing
 * differs). An amount says by how much it was too heavy or too light: none for weighting that felt right.
 * The caller holds the Dive's lock, raises its version and writes the Revision.
 */
export async function setWeightingFeedback(tx: Tx, current: DiveRow, input: WeightingFeedbackInput | null): Promise<Changes> {
  const before = weightingFeedbackOf(current);
  const next: WeightingFeedback | null = input && { felt: input.felt, amountKg: input.amountKg ?? null };
  if (JSON.stringify(before) === JSON.stringify(next)) return {};
  if (next?.felt === 'right' && next.amountKg !== null) throw new WeightingError('weighting_feedback_invalid');
  await tx.update(dive).set({ weightingFelt: next?.felt ?? null, weightingAmountKg: next?.amountKg ?? null }).where(eq(dive.id, current.id));
  return { weightingFeedback: { from: before, to: next } };
}

/** The exposure suit of a Dive (ADR 0031); the type `none` is a dive without one. */
export interface Suit {
  type: SuitType;
  /** For a wetsuit or a semidry suit. */
  thicknessMm: number | null;
  hood: boolean | null;
  /** Under a drysuit. */
  undergarment: SuitUndergarment | null;
}
export type SuitInput = Pick<Suit, 'type'> & Partial<Suit>;

export const suitOf = (row: Pick<DiveRow, 'suitType' | 'suitThicknessMm' | 'suitHood' | 'suitUndergarment'>): Suit | null =>
  (row.suitType ? { type: row.suitType, thicknessMm: row.suitThicknessMm, hood: row.suitHood, undergarment: row.suitUndergarment } : null);

/**
 * Sets or takes away the Dive's exposure suit and answers the change for the Dive's Revision (empty when nothing
 * differs). The caller holds the Dive's lock, raises its version and writes the Revision.
 */
export async function setSuit(tx: Tx, current: DiveRow, input: SuitInput | null): Promise<Changes> {
  const before = suitOf(current);
  const next: Suit | null = input && {
    type: input.type, thicknessMm: input.thicknessMm ?? null, hood: input.hood ?? null, undergarment: input.undergarment ?? null,
  };
  if (JSON.stringify(before) === JSON.stringify(next)) return {};
  if (next?.thicknessMm != null && next.type !== 'wetsuit' && next.type !== 'semidry') throw new WeightingError('suit_invalid');
  if (next?.undergarment != null && next.type !== 'drysuit') throw new WeightingError('suit_invalid');
  await tx.update(dive).set({
    suitType: next?.type ?? null, suitThicknessMm: next?.thicknessMm ?? null, suitHood: next?.hood ?? null, suitUndergarment: next?.undergarment ?? null,
  }).where(eq(dive.id, current.id));
  return { suit: { from: before, to: next } };
}

/**
 * Merging two Dives (ADR 0038): the kept Dive takes the other's Lead, weighting feedback and suit, each where it has
 * none itself. Answers the changes for the Revision.
 */
export async function takeWeighting(tx: Tx, kept: DiveRow, other: DiveRow): Promise<Changes> {
  const theirs = (await leadOf(tx, kept.id)).length === 0 ? await leadOf(tx, other.id) : [];
  const feedback = weightingFeedbackOf(kept) ? null : weightingFeedbackOf(other);
  const suit = suitOf(kept) ? null : suitOf(other);
  return {
    ...(theirs.length > 0 && (await setLead(tx, kept.id, theirs))),
    ...(feedback && (await setWeightingFeedback(tx, kept, feedback))),
    ...(suit && (await setSuit(tx, kept, suit))),
  };
}
