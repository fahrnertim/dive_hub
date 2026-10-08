// A Dive's Cylinders in its form (ADR 0045): pressures in the User's unit (whole bar or psi, as a gauge is read), sizes
// in litres; filled from the cylinder catalogue or from the Diver's last dive.
import type { paths } from '@dive-hub/api-client';
import { pressureFromDisplay, pressureIn, type UnitSystem } from './units.ts';

type Json<P extends keyof paths> = paths[P] extends { get: { responses: { 200: { content: { 'application/json': infer T } } } } } ? T : never;
export type CylinderView = Json<'/api/dives/{id}'>['cylinders'][number];
export type CatalogueCylinder = Json<'/api/cylinder-catalogue'>[number];
export type LastCylinder = Json<'/api/dives/{id}/same-as-last'>['cylinders'][number];
/** What the Dive's edit takes. */
export type CylinderInput = Omit<CylinderView, 'fromPod'>;
export type CylinderMaterial = NonNullable<CylinderView['material']>;

/** One Cylinder's fields; an empty number field is NaN. */
export interface CylinderDraft {
  /** Stable while the form is open, for React's keys. */
  key: string;
  volumeL: number;
  workingPressure: number;
  material: CylinderMaterial | null;
  o2: number;
  he: number;
  startPressure: number;
  endPressure: number;
  series: CylinderView['series'];
  /** The Cylinder as it was loaded: a value nobody touched is saved as it was, not as the field rounded it. */
  loaded?: CylinderView;
}

let drafts = 0;
const nextKey = () => `cylinder-${++drafts}`;
const orNaN = (n: number | null | undefined) => n ?? Number.NaN;
const shownPressure = (bar: number | null | undefined, units: UnitSystem) => (bar == null ? Number.NaN : Math.round(pressureIn(bar, units)));
const sameNumber = (a: number, b: number) => a === b || (Number.isNaN(a) && Number.isNaN(b));

export const emptyDraft = (): CylinderDraft => ({
  key: nextKey(), volumeL: Number.NaN, workingPressure: Number.NaN, material: null, o2: Number.NaN, he: Number.NaN,
  startPressure: Number.NaN, endPressure: Number.NaN, series: null,
});

export const draftOfCylinder = (c: CylinderView, units: UnitSystem): CylinderDraft => ({
  key: nextKey(), volumeL: orNaN(c.volumeL), workingPressure: shownPressure(c.workingPressureBar, units), material: c.material,
  o2: orNaN(c.gas?.o2), he: orNaN(c.gas?.he),
  startPressure: shownPressure(c.startPressureBar, units), endPressure: shownPressure(c.endPressureBar, units),
  series: c.series, loaded: c,
});

/** The drafts as the Dive's edit takes them. */
export function cylindersOfDrafts(list: CylinderDraft[], units: UnitSystem): CylinderInput[] {
  return list.map((d) => {
    const bar = (shown: number, loaded: number | null | undefined) => {
      if (sameNumber(shown, shownPressure(loaded, units))) return loaded ?? null;
      return Number.isNaN(shown) ? null : pressureFromDisplay(shown, units);
    };
    return {
      volumeL: Number.isNaN(d.volumeL) ? null : d.volumeL,
      workingPressureBar: bar(d.workingPressure, d.loaded?.workingPressureBar),
      material: d.material,
      gas: Number.isNaN(d.o2) ? null : { o2: d.o2, he: Number.isNaN(d.he) ? 0 : d.he },
      startPressureBar: bar(d.startPressure, d.loaded?.startPressureBar),
      endPressureBar: bar(d.endPressure, d.loaded?.endPressureBar),
      series: d.series,
    };
  });
}

/** A Cylinder nobody typed anything into: the form doesn't save it. */
export const isBlank = (d: CylinderDraft) =>
  [d.volumeL, d.workingPressure, d.o2, d.he, d.startPressure, d.endPressure].every(Number.isNaN) && d.material === null && d.series === null;

/** Picking a cylinder from the catalogue fills what the cylinder is; what was in it stays. */
export const fromCatalogue = (draft: CylinderDraft, entry: CatalogueCylinder, units: UnitSystem): CylinderDraft => ({
  ...draft, volumeL: entry.volumeL, workingPressure: shownPressure(entry.workingPressureBar, units), material: entry.material,
});

/** "Same as last dive": the last dive's Cylinders, their pressures left to type. */
export const fromLastDive = (last: LastCylinder[], units: UnitSystem): CylinderDraft[] =>
  last.map((c) => ({
    ...emptyDraft(), volumeL: orNaN(c.volumeL), workingPressure: shownPressure(c.workingPressureBar, units), material: c.material,
    o2: orNaN(c.gas?.o2), he: orNaN(c.gas?.he),
  }));

/** Whether two lists of drafts would save the same. */
export const sameDrafts = (a: CylinderDraft[], b: CylinderDraft[], units: UnitSystem) =>
  JSON.stringify(cylindersOfDrafts(a, units)) === JSON.stringify(cylindersOfDrafts(b, units));
