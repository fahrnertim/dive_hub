// What the route loads for the lead estimate (ADR 0031, slice 20b): the Diver's Dives with their lead, feedback, suit, site
// water and Cylinders, and the latest body weight, as the engine's plain data. Read only; nothing is stored.
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { cylinder, dive, diveSite, diver, diverBodyWeight, diverManagement, lead } from '../db/schema.js';
import { leadTotalKg, suitOf, weightingFeedbackOf } from '../dives/weighting.js';
import { estimateLead } from './estimate.js';
import type { EstimateDive, LeadEstimate, LeadUnit, PlannedConditions } from './types.js';

/** A Dive the estimate looked at, for the answer to link: the engine knows only its ID. */
export interface DiveReference {
  startsAt: Date;
  number: number | null;
}

export interface LeadEstimateAnswer {
  estimate: LeadEstimate;
  dives: Map<string, DiveReference>;
  /** Dives with lead and a suit that no estimate can use because their site has no water type (or they have no site). */
  noWaterType: number;
}

/** Whether the User keeps the Diver's logbook (and the Diver is not deleted): the only ones who may ask. */
export async function managesDiver(db: Db, userId: string, diverId: string): Promise<boolean> {
  const [row] = await db.select({ id: diverManagement.diverId }).from(diverManagement)
    .innerJoin(diver, eq(diver.id, diverManagement.diverId))
    .where(and(eq(diverManagement.userId, userId), eq(diverManagement.diverId, diverId), isNull(diver.deletedAt)));
  return row !== undefined;
}

export async function leadEstimateOf(
  db: Db, diverId: string, plan: PlannedConditions, unit: LeadUnit, today = new Date(),
): Promise<LeadEstimateAnswer> {
  const rows = await db.select({ d: dive, siteWater: diveSite.waterType }).from(dive)
    .leftJoin(diveSite, eq(diveSite.id, dive.siteId))
    .where(and(eq(dive.diverId, diverId), isNull(dive.deletedAt)));
  const ids = rows.map((r) => r.d.id);
  const [leadRows, cylinderRows, [bodyWeight]] = await Promise.all([
    ids.length === 0 ? [] : db.select().from(lead).where(inArray(lead.diveId, ids)).orderBy(lead.diveId, lead.position),
    ids.length === 0 ? [] : db.select().from(cylinder).where(inArray(cylinder.diveId, ids)).orderBy(cylinder.diveId, cylinder.position),
    db.select({ kg: diverBodyWeight.kg }).from(diverBodyWeight).where(eq(diverBodyWeight.diverId, diverId))
      .orderBy(desc(diverBodyWeight.date)).limit(1),
  ]);

  const leadOf = new Map<string, { amountKg: number; placement: null }[]>();
  for (const l of leadRows) leadOf.set(l.diveId, [...(leadOf.get(l.diveId) ?? []), { amountKg: l.amountKg, placement: null }]);
  const cylindersOf = new Map<string, EstimateDive['cylinders']>();
  for (const c of cylinderRows) {
    // A Cylinder without a volume says nothing about buoyancy: the Dive counts as one without a Cylinder.
    if (c.volumeL === null) continue;
    cylindersOf.set(c.diveId, [...(cylindersOf.get(c.diveId) ?? []), { volumeL: c.volumeL, material: c.material, endPressureBar: c.endPressureBar }]);
  }

  const dives: EstimateDive[] = rows.map(({ d, siteWater }) => ({
    id: d.id, date: d.startsAt, leadKg: leadTotalKg(leadOf.get(d.id) ?? []), feedback: weightingFeedbackOf(d), suit: suitOf(d),
    water: siteWater, cylinders: cylindersOf.get(d.id) ?? [],
  }));
  const estimate = estimateLead({ dives, bodyWeightKg: bodyWeight?.kg ?? null, plan, unit, today });
  return {
    estimate,
    dives: new Map(rows.map(({ d }) => [d.id, { startsAt: d.startsAt, number: d.number }])),
    noWaterType: dives.filter((d) => d.leadKg !== null && d.suit !== null && d.water === null).length,
  };
}
