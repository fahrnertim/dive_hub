// SSI's dive type (`odin_user_log_dive_type`) and Dive Hub's dive mode (ADR 0057). Pure.
import type { DiveMode } from '../../vocabulary.js';

/**
 * The dive type Dive Hub sends: apnea 6, CCR 8, SCR 4, open circuit with two or more gases 2, else 0. Null when
 * nothing is known (no dive mode, no gases), so an update leaves SSI's value.
 */
export function ssiDiveType(mode: DiveMode | null, gasCount: number): number | null {
  if (mode === null && gasCount === 0) return null;
  if (mode === 'apnea') return 6;
  if (mode === 'ccr') return 8;
  if (mode === 'scr') return 4;
  return gasCount >= 2 ? 2 : 0;
}

/** The dive mode of an SSI dive type: 6 and 7 apnea, 8 and 9 CCR, 4 and 5 SCR, 0 to 3 open circuit; else unknown. */
export function diveModeOfSsi(type: unknown): DiveMode | null {
  const n = typeof type === 'number' ? type : typeof type === 'string' && type.trim() !== '' ? Number(type) : NaN;
  if (!Number.isInteger(n)) return null;
  if (n === 6 || n === 7) return 'apnea';
  if (n === 8 || n === 9) return 'ccr';
  if (n === 4 || n === 5) return 'scr';
  if (n >= 0 && n <= 3) return 'open_circuit';
  return null;
}

/** SSI marks a training dive as its base type plus one (7 for 6, and so on): that value stays when it is ours plus one. */
export function keepTraining(remote: unknown, ours: number | null): number | null {
  const n = typeof remote === 'number' ? remote : typeof remote === 'string' && remote.trim() !== '' ? Number(remote) : NaN;
  return ours !== null && ours % 2 === 0 && n === ours + 1 ? n : ours;
}
