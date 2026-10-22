// A gas plan (ADR 0033, slice 22): the litres of each stretch of a planned dive, and per Diver the pressures that follow
// from their Cylinder and SAC - end, rock bottom, the ascent pressure of the chosen rule. Limits from the Diver's own input
// and settings, not advice; the dive computer and training govern. Air and nitrox 21 to 40 %, at most 40 m.
import { pressureForLitres, surfaceLitres } from '../dives/real-gas.js';
import { ambientPressureBar, modMetres, type Conditions, type GasMix } from './gas.js';
import { DESCENT_RATE_M_PER_MIN } from './ndl.js';

/** Deeper than this is never answered (ADR 0032). */
export const MAX_DEPTH_M = 40;
export const ASCENT_RATE_M_PER_MIN = 9;
export const SAFETY_STOP = { depthM: 5, minutes: 3 };

/** Never ascend below this with the default rule (ADR 0033). */
export const MIN_ASCENT_BAR = 50;
export const ROCK_BOTTOM = { stress: 2, problemMinutes: 1, marginBar: 10 };

/** Turn rules share the supply out and back; the share of the smaller supply spent on the way out. */
export const TURN_SHARES = { halves: 1 / 2, thirds: 1 / 3, sixths: 1 / 6 } as const;
export type TurnRule = keyof typeof TURN_SHARES;

export type GasRule =
  | { kind: 'rock_bottom' }
  /** Finish the dive with this pressure left. */
  | { kind: 'reserve'; bar: number }
  /** Start the ascent at this pressure. */
  | { kind: 'ascent_pressure'; bar: number }
  | { kind: TurnRule };

export interface GasPlanInput {
  gas: GasMix;
  conditions: Conditions;
  /** Depth and the minutes spent there after arriving. */
  levels: { depthM: number; minutes: number }[];
  divers: { name: string; volumeL: number; startPressureBar: number; sacLpm: number }[];
  rule: GasRule;
  ppO2Contingency: number;
  /** Metres a minute between levels and to the surface; 18 down and 9 up when left out. */
  descentRateMPerMin?: number | undefined;
  ascentRateMPerMin?: number | undefined;
}

export interface PlanSegment {
  kind: 'descent' | 'level' | 'ascent' | 'safety_stop';
  /** Where it starts and where it ends (the same for a level and the stop); in the order they are dived. */
  fromDepthM: number;
  depthM: number;
  minutes: number;
  /** Mean ambient pressure over the stretch. */
  ambientBar: number;
}

export interface DiverPlan {
  name: string;
  /** Litres at the surface's pressure over the whole plan. */
  litres: number;
  endPressureBar: number;
  /** At every level: the pressure that covers two Divers' trouble there and a direct ascent, plus the margin. */
  rockBottom: { depthM: number; pressureBar: number }[];
  /** The pressure at which this Diver must start up, by the chosen rule. */
  ascentPressureBar: number;
  /** Where this Diver turns, under halves, thirds and sixths; otherwise null. */
  turnPressureBar: number | null;
  /** The ascent pressure is below rock bottom: the rule leaves less than two Divers' trouble needs. */
  belowRockBottom: boolean;
  /** The pressure at the end of the last level, when the plan starts up. */
  atAscentStartBar: number;
  /** The pressure at the start and at the end of every stretch: one more than there are stretches. */
  pressuresBar: number[];
  marginBar: number;
  /** Minutes more at the last level before the ascent pressure; negative when the plan stays too long. */
  marginMinutes: number;
  controlling: boolean;
}

export type GasPlan =
  | {
      status: 'ok'; runtimeMinutes: number; segments: PlanSegment[]; divers: DiverPlan[];
      /** The Diver who runs out of margin first: the plan follows them. */
      controllingIndex: number;
      fits: boolean;
      /** The run time at which to leave the last level for the controlling Diver to start up at their ascent pressure. */
      leaveLastLevelAtMinute: number;
    }
  | { status: 'outside_limits'; reason: 'depth' | 'mod' | 'gas'; levelIndex: number | null };

export function planGas(input: GasPlanInput): GasPlan {
  const { gas, conditions, levels, divers } = input;
  if (gas.he !== 0 || gas.o2 < 21 || gas.o2 > 40) return { status: 'outside_limits', reason: 'gas', levelIndex: null };
  const mod = modMetres(gas, input.ppO2Contingency, conditions);
  for (const [i, level] of levels.entries()) {
    if (level.depthM > MAX_DEPTH_M) return { status: 'outside_limits', reason: 'depth', levelIndex: i };
    if (level.depthM > mod) return { status: 'outside_limits', reason: 'mod', levelIndex: i };
  }

  const ambient = (depthM: number) => ambientPressureBar(depthM, conditions);
  const descentRate = input.descentRateMPerMin ?? DESCENT_RATE_M_PER_MIN;
  const ascentRate = input.ascentRateMPerMin ?? ASCENT_RATE_M_PER_MIN;
  const segments: PlanSegment[] = [];
  let at = 0;
  const move = (toM: number) => {
    if (toM === at) return;
    const down = toM > at;
    segments.push({
      kind: down ? 'descent' : 'ascent', fromDepthM: at, depthM: toM,
      minutes: Math.abs(toM - at) / (down ? descentRate : ascentRate), ambientBar: (ambient(at) + ambient(toM)) / 2,
    });
    at = toM;
  };
  const stay = (kind: 'level' | 'safety_stop', minutes: number) => segments.push({ kind, fromDepthM: at, depthM: at, minutes, ambientBar: ambient(at) });
  for (const level of levels) {
    move(level.depthM);
    stay('level', level.minutes);
  }
  if (at > SAFETY_STOP.depthM) {
    move(SAFETY_STOP.depthM);
    stay('safety_stop', SAFETY_STOP.minutes);
  }
  move(0);

  // Litres of one Diver per litre-a-minute of SAC: all of it, and the ascent with its safety stop.
  const perSac = segments.reduce((sum, s) => sum + s.minutes * s.ambientBar, 0);
  const finalStretch = segments.slice(segments.findLastIndex((s) => s.kind === 'level') + 1);
  const ascentPerSac = finalStretch.reduce((sum, s) => sum + s.minutes * s.ambientBar, 0);
  const minutesToLeave = segments.slice(0, segments.length - finalStretch.length).reduce((sum, s) => sum + s.minutes, 0);
  const lastDepthM = levels[levels.length - 1]!.depthM;
  // Sharing gas, a group comes up no faster than it planned to, and never faster than the usual rate.
  const troubleRate = Math.min(ascentRate, ASCENT_RATE_M_PER_MIN);
  const rockBottomPerSac = (depthM: number) =>
    ROCK_BOTTOM.problemMinutes * ambient(depthM) + (depthM / troubleRate) * ((ambient(depthM) + ambient(0)) / 2);

  const startLitres = divers.map((d) => surfaceLitres(d.volumeL, d.startPressureBar, gas));
  // Turn rules are matched by litres: the smaller supply sets what is spent on the way out.
  const turnLitres = input.rule.kind in TURN_SHARES ? TURN_SHARES[input.rule.kind as TurnRule] * Math.min(...startLitres) : 0;

  const plans = divers.map((d, i): DiverPlan => {
    const others = divers.filter((_, j) => j !== i).map((o) => o.sacLpm);
    const buddySac = others.length > 0 ? Math.max(...others) : d.sacLpm;
    const litres = d.sacLpm * perSac;
    const rockBottom = levels.map((l) => ({
      depthM: l.depthM,
      pressureBar: pressureForLitres(d.volumeL, (d.sacLpm + buddySac) * ROCK_BOTTOM.stress * rockBottomPerSac(l.depthM), gas) + ROCK_BOTTOM.marginBar,
    }));
    const highestRockBottom = Math.max(...rockBottom.map((r) => r.pressureBar));
    const ascentLitres = d.sacLpm * ascentPerSac;
    const rule = input.rule;
    const turnPressureBar = rule.kind in TURN_SHARES ? pressureForLitres(d.volumeL, startLitres[i]! - turnLitres, gas) : null;
    const ascentPressureBar =
      rule.kind === 'rock_bottom' ? Math.max(MIN_ASCENT_BAR, highestRockBottom)
      : rule.kind === 'ascent_pressure' ? rule.bar
      : rule.kind === 'reserve' ? pressureForLitres(d.volumeL, surfaceLitres(d.volumeL, rule.bar, gas) + ascentLitres, gas)
      // Out and back spends twice the turn litres; what is left is the reserve, and the ascent comes on top.
      : pressureForLitres(d.volumeL, startLitres[i]! - 2 * turnLitres + ascentLitres, gas);
    // In litres, which go negative when the plan overdraws the Cylinder (a pressure would stop at 0).
    const atAscentStartLitres = startLitres[i]! - (litres - ascentLitres);
    const atAscentStartBar = pressureForLitres(d.volumeL, atAscentStartLitres, gas);
    const marginLitres = atAscentStartLitres - surfaceLitres(d.volumeL, ascentPressureBar, gas);
    let spent = 0;
    const pressuresBar = [d.startPressureBar, ...segments.map((s) => {
      spent += d.sacLpm * s.minutes * s.ambientBar;
      return pressureForLitres(d.volumeL, startLitres[i]! - spent, gas);
    })];
    return {
      name: d.name, litres, pressuresBar,
      endPressureBar: pressureForLitres(d.volumeL, startLitres[i]! - litres, gas),
      rockBottom, ascentPressureBar, turnPressureBar,
      belowRockBottom: ascentPressureBar < highestRockBottom - 1e-6,
      atAscentStartBar, marginBar: atAscentStartBar - ascentPressureBar,
      marginMinutes: marginLitres / (d.sacLpm * ambient(lastDepthM)),
      controlling: false,
    };
  });
  const controllingIndex = plans.reduce((best, p, i) => (p.marginMinutes < plans[best]!.marginMinutes ? i : best), 0);
  plans[controllingIndex]!.controlling = true;
  const leftover = plans[controllingIndex]!.marginMinutes;
  return {
    status: 'ok', runtimeMinutes: segments.reduce((sum, s) => sum + s.minutes, 0), segments, divers: plans,
    controllingIndex, fits: leftover >= 0, leaveLastLevelAtMinute: minutesToLeave + leftover,
  };
}
