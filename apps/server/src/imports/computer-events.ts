// A stored Recording event as a computer event in our vocabulary (ADR 0036), whichever Source's adapter stored it.
import { computerEventFromFit } from './formats/fit/fit-vocabulary.js';
import { computerEventFromSuunto } from './formats/suunto/suunto-vocabulary.js';
import type { ComputerEvent } from '../vocabulary.js';

export function computerEventOf(type: string, data: Record<string, unknown>): ComputerEvent | undefined {
  return computerEventFromFit(type, data) ?? computerEventFromSuunto(type, data);
}
