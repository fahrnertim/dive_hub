// The planning calculations for a signed-in User (ADR 0053): the route passes the User's id, the service finds the Divers
// they manage, so a route holds no query.
import type { Db } from '../db/client.js';
import { managedDiverIds } from '../dives/dive-service.js';
import { planGasPlan, type GasPlanQuery } from './plan-service.js';
import { planBottomTime, type BottomTimeQuery } from './service.js';

export function createPlanningService(db: Db) {
  const managedBy = async (userId: string) => [...(await managedDiverIds(db, userId))];
  return {
    bottomTime: async (userId: string, q: BottomTimeQuery) => planBottomTime(db, await managedBy(userId), q),
    gasPlan: async (userId: string, q: GasPlanQuery) => planGasPlan(db, await managedBy(userId), q),
  };
}

export type PlanningService = ReturnType<typeof createPlanningService>;
