import { describe, expect, it } from 'vitest';
import { orderItems, planItem, type PlanOptions, type PlanStatus } from '../src/providers/push-run-plan.js';

const options = (o: Partial<PlanOptions> = {}): PlanOptions => ({ updates: false, updatesRemovingVerification: false, numbers: false, canUpdate: true, ...o });
const there = (c: Partial<NonNullable<PlanStatus['current']>> = {}): PlanStatus => ({
  unmet: [], current: { upToDate: true, updateRemovesVerification: false, remoteNumber: 5, number: null, ...c },
});
const differing = (removes = false) => ({ wanted: 3, differs: true, canSet: true, removesVerification: removes });

describe('planItem', () => {
  it('sends a Dive that is not at the Provider', () => {
    expect(planItem({ unmet: [], current: null }, options())).toEqual({ send: 'create' });
  });
  it('leaves out a Dive a blocking requirement holds back, but not an advisory one', () => {
    expect(planItem({ unmet: [{ severity: 'blocking' }], current: null }, options())).toEqual({ leftOut: 'requirements_unmet', numberNotChosen: false });
    expect(planItem({ unmet: [{ severity: 'advisory' }], current: null }, options())).toEqual({ send: 'create' });
  });
  it('leaves out a Dive that is up to date', () => {
    expect(planItem(there(), options({ updates: true }))).toEqual({ leftOut: 'up_to_date', numberNotChosen: false });
  });
  it('updates a changed Dive only when updates are chosen', () => {
    const changed = there({ upToDate: false });
    expect(planItem(changed, options())).toEqual({ leftOut: 'update_not_chosen', numberNotChosen: false });
    expect(planItem(changed, options({ updates: true }))).toEqual({ send: 'update' });
    expect(planItem(changed, options({ updates: true, canUpdate: false }))).toEqual({ leftOut: 'update_unsupported', numberNotChosen: false });
  });
  it('updates one that loses a verification only with the second choice too', () => {
    const verified = there({ upToDate: false, updateRemovesVerification: true });
    expect(planItem(verified, options({ updates: true }))).toEqual({ leftOut: 'removes_verification', numberNotChosen: false });
    expect(planItem(verified, options({ updates: true, updatesRemovingVerification: true }))).toEqual({ send: 'update' });
  });
  it('sets the number of an up-to-date Dive only with numbers', () => {
    const status = there({ number: differing() });
    expect(planItem(status, options())).toEqual({ leftOut: 'up_to_date', numberNotChosen: true });
    expect(planItem(status, options({ numbers: true }))).toEqual({ send: 'number', wanted: 3, held: 5 });
  });
  it('sets the number of a changed Dive whose update is not chosen', () => {
    const status = there({ upToDate: false, number: differing() });
    expect(planItem(status, options({ numbers: true }))).toEqual({ send: 'number', wanted: 3, held: 5 });
    expect(planItem(status, options())).toEqual({ leftOut: 'update_not_chosen', numberNotChosen: true });
  });
  it('needs the second choice where a number change can remove a verification', () => {
    const status = there({ number: differing(true) });
    expect(planItem(status, options({ numbers: true }))).toEqual({ leftOut: 'removes_verification', numberNotChosen: false });
    expect(planItem(status, options({ numbers: true, updatesRemovingVerification: true }))).toEqual({ send: 'number', wanted: 3, held: 5 });
  });
  it('never sets a number where the Connection does not follow, the number is the same or cannot be set', () => {
    expect(planItem(there({ number: null }), options({ numbers: true }))).toEqual({ leftOut: 'up_to_date', numberNotChosen: false });
    expect(planItem(there({ number: { ...differing(), differs: false } }), options({ numbers: true }))).toEqual({ leftOut: 'up_to_date', numberNotChosen: false });
    expect(planItem(there({ number: { ...differing(), canSet: false } }), options({ numbers: true }))).toEqual({ leftOut: 'up_to_date', numberNotChosen: false });
  });
});

describe('orderItems', () => {
  const number = (diveId: string, wanted: number, held: number) => ({ diveId, startsAt: new Date(0), planned: { send: 'number' as const, wanted, held } });
  const create = (diveId: string, day: number) => ({ diveId, startsAt: new Date(Date.UTC(2020, 0, day)), planned: { send: 'create' as const } });

  it('puts numbers moving up from the highest down, and those moving down from the lowest up', () => {
    const up = orderItems([number('a', 2, 1), number('b', 3, 2), number('c', 4, 3)], new Map([['a', 1], ['b', 2], ['c', 3]]));
    expect(up.ordered.map((i) => i.diveId)).toEqual(['c', 'b', 'a']);
    const down = orderItems([number('a', 1, 2), number('b', 2, 3), number('c', 3, 4)], new Map([['a', 2], ['b', 3], ['c', 4]]));
    expect(down.ordered.map((i) => i.diveId)).toEqual(['a', 'b', 'c']);
  });
  it('leaves out Dives that only swap numbers among themselves', () => {
    const { ordered, numberTaken } = orderItems([number('a', 2, 1), number('b', 1, 2)], new Map([['a', 1], ['b', 2]]));
    expect(ordered).toEqual([]);
    expect(numberTaken.map((i) => i.diveId).sort()).toEqual(['a', 'b']);
  });
  it('puts creates and updates after the number changes, oldest first', () => {
    const { ordered } = orderItems([create('late', 9), number('a', 2, 1), create('early', 3)], new Map([['a', 1]]));
    expect(ordered.map((i) => i.diveId)).toEqual(['a', 'early', 'late']);
  });
});
