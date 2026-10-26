// The error and the unique-violation check that site code shares. They live apart from site-service so that
// site-ids.ts and site-service.ts can both use them without importing each other.

export class SiteError extends Error {
  constructor(readonly code:
    | 'site_not_found' | 'site_changed' | 'site_in_use' | 'site_not_deletable' | 'external_id_taken' | 'site_merge_self'
    | 'site_offer_not_found' | 'site_source_not_typed' | 'invalid_input') {
    super(code);
  }
}

/** A PostgreSQL unique violation, however deep the driver and Drizzle wrapped it. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (let e = error as { code?: string; constraint?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === '23505') return !constraint || e.constraint === constraint;
  }
  return false;
}
