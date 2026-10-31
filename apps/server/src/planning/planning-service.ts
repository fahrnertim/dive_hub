// The planning calculations for a signed-in User (ADR 0053): the route passes the User's id, the service finds the Divers
// they manage, so a route holds no query.
import type { Db } from '../db/client.js';
import { managedDiverIds } from '../divers/management.js';
import { planBottomTime, type BottomTimeQuery } from './bottom-time-service.js';
import { planGasPlan, type GasPlanQuery } from './gas-plan-service.js';

export function createPlanningService(db: Db) {
  const managedBy = async (userId: string) => [...(await managedDiverIds(db, userId))];
  return {
    bottomTime: async (userId: string, query: BottomTimeQuery) => planBottomTime(db, await managedBy(userId), query),
    gasPlan: async (userId: string, query: GasPlanQuery) => planGasPlan(db, await managedBy(userId), query),
  };
}

export type PlanningService = ReturnType<typeof createPlanningService>;
