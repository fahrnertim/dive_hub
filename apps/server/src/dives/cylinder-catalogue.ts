// The cylinder catalogue (ADR 0031, 0045): common cylinders in code, like the vocabularies. Picking one fills a
// Cylinder's volume, working pressure and material; any value can be typed instead, and the Cylinder keeps no link to it.
// Aluminium sizes are Luxfer's (water volume, service pressure); steel ones the sizes sold in Europe at 200, 232 and
// 300 bar. Buoyancy for the lead estimate comes with it (docs/research/2026-10-06-weight-calculator.md).
import type { CylinderMaterial } from '../db/schema.js';

export interface CatalogueCylinder {
  id: string;
  /** The name it is sold and asked for under, the same in every language; null where size and pressure name it. */
  tradeName: string | null;
  /** Two cylinders on one manifold; the volume is that of both. */
  twin: boolean;
  volumeL: number;
  workingPressureBar: number;
  material: CylinderMaterial;
}

const aluminium = (tradeName: string, volumeL: number, workingPressureBar: number): CatalogueCylinder => ({
  id: tradeName.toLowerCase(), tradeName, twin: false, volumeL, workingPressureBar, material: 'aluminium',
});
const steel = (litres: number, workingPressureBar: number, twin = false): CatalogueCylinder => ({
  id: `${twin ? 'twin-' : ''}steel-${litres}-${workingPressureBar}`, tradeName: null, twin,
  volumeL: twin ? litres * 2 : litres, workingPressureBar, material: 'steel',
});

export const CYLINDER_CATALOGUE: readonly CatalogueCylinder[] = [
  aluminium('AL80', 11.1, 207), aluminium('AL63', 9, 207), aluminium('AL100', 13.1, 228), aluminium('AL40', 5.7, 207),
  steel(7, 200), steel(7, 300),
  steel(10, 200), steel(10, 232), steel(10, 300),
  steel(12, 200), steel(12, 232), steel(12, 300),
  steel(15, 200), steel(15, 232),
  steel(12, 232, true),
];
