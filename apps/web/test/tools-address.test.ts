// The Tools page's parts in the address: gas numbers and a bottom time at #/tools, the gas plan at #/tools/plan (ADR 0033).
import { describe, expect, it } from 'vitest';
import { toolsHref, toolsParams, toolsTabHref } from '../src/lib/tools.ts';

const of = (query: string, tool?: 'gas' | 'plan') => toolsParams(new URLSearchParams(query), tool);

describe('the address of a part of Tools', () => {
  it('names the plan in its path and nothing for gas numbers', () => {
    expect(toolsHref({ o2: 32, depth: 30 })).toBe('#/tools?o2=32&depth=30');
    expect(toolsHref({ tool: 'plan', mix: 32, levels: [{ depth: 20, minutes: 20 }] })).toBe('#/tools/plan?mix=32&lv=20x20');
    expect(toolsHref({ tool: 'plan' })).toBe('#/tools/plan');
  });

  it('reads only what its part reads, and the settings both share', () => {
    expect(of('o2=32&depth=30&mix=36&water=fresh&ar=6')).toEqual({ o2: 32, depth: 30, water: 'fresh' });
    expect(of('o2=32&depth=30&mix=36&water=fresh&ar=6', 'plan')).toEqual({ tool: 'plan', mix: 36, water: 'fresh', ar: 6 });
  });

  it('takes an address with levels or Divers for the plan, as before the plan had its own part', () => {
    expect(of('o2=21&lv=20x20')).toEqual({ tool: 'plan', levels: [{ depth: 20, minutes: 20 }] });
  });

  it('goes to the other part with the shared settings of now and that part as it was last', () => {
    const plan = of('mix=32&lv=20x20&rule=thirds&water=fresh', 'plan');
    expect(toolsTabHref(plan, 'gas', { o2: 32, depth: 30, water: 'salt' })).toBe('#/tools?o2=32&depth=30&water=fresh&rule=thirds');
    expect(toolsTabHref({ o2: 32, pc: 1.5 }, 'plan', plan)).toBe('#/tools/plan?pc=1.5&mix=32&lv=20x20');
    expect(toolsTabHref(plan, 'plan', {})).toBe(toolsHref(plan));
    expect(toolsTabHref({ o2: 32 }, 'plan', {})).toBe('#/tools/plan');
  });
});
