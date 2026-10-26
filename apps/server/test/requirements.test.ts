// Push requirements (ADR 0029, piece 4): a site requirement a send fixes itself (`createdBySend`, a site with a position)
// doesn't stop the send before it has found or created the site; without a position or without a site it blocks as before.
import { describe, expect, it } from 'vitest';
import type { OutgoingDive, Requirement } from '../src/providers/provider.js';
import { blocking, unmetRequirements } from '../src/providers/requirements.js';

const bySend: Requirement = { type: 'site_external_id', severity: 'blocking', source: 'ssi', description: '', createdBySend: true };
const typedOnly: Requirement = { type: 'site_external_id', severity: 'blocking', source: 'ssi', description: '' };
const dive = (siteIds: OutgoingDive['siteIds'] = {}) => ({ siteIds, participants: [] }) as unknown as OutgoingDive;

describe('site_external_id', () => {
  it('a site with a position, at a Provider that creates sites: by the send, not blocking before the site', () => {
    const unmet = unmetRequirements([bySend], { id: 's1', positioned: true }, dive());
    expect(unmet).toEqual([{ type: 'site_external_id', severity: 'blocking', source: 'ssi', siteId: 's1', bySend: true }]);
    expect(blocking(unmet, { beforeSite: true })).toEqual([]);
    expect(blocking(unmet)).toHaveLength(1);
  });

  it('a site without a position blocks', () => {
    const unmet = unmetRequirements([bySend], { id: 's1', positioned: false }, dive());
    expect(unmet).toMatchObject([{ siteId: 's1', bySend: false }]);
    expect(blocking(unmet, { beforeSite: true })).toHaveLength(1);
  });

  it('no site blocks as before', () => {
    const unmet = unmetRequirements([bySend], null, dive());
    expect(unmet).toMatchObject([{ siteId: null, bySend: false }]);
    expect(blocking(unmet, { beforeSite: true })).toHaveLength(1);
  });

  it('a Provider that doesn\'t create sites blocks; a site with the ID meets it', () => {
    expect(unmetRequirements([typedOnly], { id: 's1', positioned: true }, dive())).toMatchObject([{ bySend: false }]);
    expect(unmetRequirements([bySend], { id: 's1', positioned: true }, dive({ ssi: '3314' }))).toEqual([]);
  });
});
