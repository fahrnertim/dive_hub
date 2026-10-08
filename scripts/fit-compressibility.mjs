// Fits the compressibility factors in apps/server/src/dives/real-gas.ts (ADR 0045, slice 3): per gas a cubic in the
// pressure, Z = 1 + a·p + b·p² + c·p³, by least squares through NIST's isotherm at 20 °C (293.15 K) from 1 to 351 bar.
// Run it to see where the numbers come from: `node scripts/fit-compressibility.mjs`. It needs the network.
// Source: NIST Chemistry WebBook, Thermophysical Properties of Fluid Systems, https://webbook.nist.gov/chemistry/fluid/

const T = 293.15;
const R = 0.0831446262; // bar·L/(mol·K)
const GASES = { o2: 'C7782447', n2: 'C7727379', he: 'C7440597' };

const isotherm = async (id) => {
  const url = `https://webbook.nist.gov/cgi/fluid.cgi?Action=Data&Wide=on&ID=${id}&Type=IsoTherm&Digits=5&PLow=1&PHigh=351&PInc=10&T=${T}`
    + '&RefState=DEF&TUnit=K&PUnit=bar&DUnit=mol%2Fl&HUnit=kJ%2Fmol&WUnit=m%2Fs&VisUnit=uPa*s&STUnit=N%2Fm';
  const rows = (await (await fetch(url)).text()).trim().split('\n').slice(1).map((line) => line.split('\t').map(Number));
  return rows.map(([, bar, molPerL]) => ({ bar, z: bar / (molPerL * R * T) }));
};

/** Solves the 3×3 system m·x = v by Gauss elimination. */
function solve(m, v) {
  const a = m.map((row, i) => [...row, v[i]]);
  for (let i = 0; i < 3; i += 1) {
    for (let k = i + 1; k < 3; k += 1) {
      const f = a[k][i] / a[i][i];
      for (let j = i; j < 4; j += 1) a[k][j] -= f * a[i][j];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i -= 1) x[i] = (a[i][3] - a[i].slice(i + 1, 3).reduce((s, c, j) => s + c * x[i + 1 + j], 0)) / a[i][i];
  return x;
}

for (const [gas, id] of Object.entries(GASES)) {
  const points = await isotherm(id);
  // Pressures in units of 100 bar keep the sums near 1.
  const m = [0, 1, 2].map((i) => [0, 1, 2].map((j) => points.reduce((s, { bar }) => s + (bar / 100) ** (i + j + 2), 0)));
  const v = [0, 1, 2].map((i) => points.reduce((s, { bar, z }) => s + (z - 1) * (bar / 100) ** (i + 1), 0));
  const coefficients = solve(m, v).map((c, i) => c / 100 ** (i + 1));
  const fitted = (bar) => 1 + coefficients.reduce((s, c, i) => s + c * bar ** (i + 1), 0);
  const worst = Math.max(...points.map(({ bar, z }) => Math.abs(fitted(bar) / z - 1)));
  console.log(`${gas}: [${coefficients.map((c) => c.toExponential(6)).join(', ')}]  worst error ${(worst * 100).toFixed(2)} % over ${points.length} points`);
  for (const bar of [51, 101, 201, 231, 301]) {
    const p = points.find((q) => q.bar === bar);
    console.log(`  ${bar} bar: NIST ${p.z.toFixed(4)}, fit ${fitted(bar).toFixed(4)}`);
  }
}
