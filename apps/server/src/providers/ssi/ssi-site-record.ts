// A dive site as SSI keeps it (checked 2026-10-24, docs/references/ssi-app-api.md "Sites"): the row Dive Hub sends to
// create a private site (the app's `siteUpload`), and the typed values of a site row SSI answers with, in the logbook
// (`logbook_sites`) and from `get_divesite`. Pure: no calls.
import type { Position, SiteWaterType } from '../../vocabulary.js';
import { alpha3Of } from '../../sites/countries.js';
import { WATER_OF_BOW } from './ssi-sites.js';

/**
 * The row the app sends to `save_divesite`, without the app-internal `internalPk` and `needsUpload`. A site made here is
 * private to the account (`accountId`, SSI's `mid`); everything Dive Hub doesn't know is null.
 */
export function ssiSiteRow(
  site: { name: string; position: Position; country: string | null; waterType: SiteWaterType | null }, accountId: string,
): Record<string, unknown> {
  return {
    odin_dive_sites_id: null,
    odin_dive_sites_name: site.name,
    bow: site.waterType === 'salt' || site.waterType === 'fresh' ? site.waterType : null,
    odin_user_log_animal_ids: null,
    odin_dive_sites_lon: site.position.longitude,
    odin_dive_sites_lat: site.position.latitude,
    odin_dive_sites_meta_address: null,
    odin_dive_sites_meta_region: null,
    odin_dive_sites_meta_country: null,
    odin_countries_code_iso: alpha3Of(site.country),
    odin_dive_sites_regions_name: null,
    odin_dive_sites_areas_name: null,
    odin_dive_sites_geo_locked: null,
    odin_dive_sites_is_private: true,
    odin_dive_sites_alias_ids: null,
    odin_dive_sites_is_private_owner: Number(accountId),
    odin_dive_sites_deleted: false,
    alias_names_search: null,
    alias_names: null,
  };
}

/** A site row of SSI in typed values. */
export interface SsiSiteValues {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** As SSI gives it: ISO alpha-2 or alpha-3, or a country name. */
  country: string | null;
  /** From SSI's `bow` (body of water): salt or fresh; artificial or missing is null. */
  waterType: SiteWaterType | null;
  deleted: boolean;
  /** Whether SSI marks the site private; null when the row doesn't say. */
  private: boolean | null;
  /** The account (SSI's `mid`) a private site belongs to; null for a public site or when the row doesn't say. */
  privateOwner: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const idText = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? String(v)
  : typeof v === 'string' && /^[1-9]\d*$/.test(v) ? v : null);
const numberOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : null);
/** SSI answers flags as 0/1 (sometimes true/false or "1"). */
const flag = (v: unknown): boolean | null => (v === true || v === 1 || v === '1' ? true : v === false || v === 0 || v === '0' ? false : null);

/** The typed values of a site row; null when it has no usable ID or name. */
export function readSsiSite(s: unknown): SsiSiteValues | null {
  if (!isObject(s)) return null;
  const id = idText(s.odin_dive_sites_id);
  const name = typeof s.odin_dive_sites_name === 'string' ? s.odin_dive_sites_name : null;
  if (!id || !name) return null;
  const latitude = numberOrNull(s.odin_dive_sites_lat);
  const longitude = numberOrNull(s.odin_dive_sites_lon);
  const country = [s.odin_countries_code_iso, s.odin_dive_sites_country_iso3, s.odin_dive_sites_meta_country]
    .find((c): c is string => typeof c === 'string' && c.length > 0) ?? null;
  const isPrivate = flag(s.odin_dive_sites_is_private);
  return {
    id, name,
    latitude: latitude !== null && longitude !== null ? latitude : null, longitude: latitude !== null ? longitude : null,
    country, waterType: typeof s.bow === 'string' ? WATER_OF_BOW[s.bow] ?? null : null,
    deleted: flag(s.odin_dive_sites_deleted) === true, private: isPrivate,
    // A private site whose owner is missing belongs to nobody we know: account 0 is no account.
    privateOwner: isPrivate ? idText(s.odin_dive_sites_is_private_owner) ?? '0' : null,
  };
}

/**
 * What the site is for the account `accountId`: `public`, `private` (SSI's flag is set and the account is its owner), `unknown`
 * (the row doesn't say), or null for a private site of another account, which Dive Hub never uses.
 */
export function visibilityFor(site: Pick<SsiSiteValues, 'private' | 'privateOwner'>, accountId: string): 'public' | 'private' | 'unknown' | null {
  if (site.private === null) return 'unknown';
  if (!site.private) return 'public';
  return site.privateOwner === accountId ? 'private' : null;
}
