---
title: Real gas in a cylinder (the compressibility factor behind "SAC on this dive")
summary: Our own cubic fit per gas (oxygen, nitrogen, helium) through NIST's isotherms at 20 °C from 1 to 351 bar, within 0.2 % of them, mixed by the gas's fractions - the coefficients, check values, why Subsurface's coefficients were not copied (GPL-2.0), and what was not verified.
status: done
date: 2026-10-08
---

# Real gas in a cylinder

For [ADR 0045](../decisions/0045-tank-pressure-cylinders-and-sac-on-a-dive.md), slice 3. The
[gas consumption note](2026-10-06-gas-consumption-planning.md) left the source open ("a cited table or a virial formula").

## What is needed
The litres at the surface that a cylinder holds: volume × pressure / Z, where Z is the compressibility factor of its
gas at that pressure (1 for an ideal gas). For air Z is about 1.03 at 200 bar and 1.11 at 300 bar: a 300 bar cylinder
holds about a tenth less than pressure × volume says.

## The source: NIST
NIST Chemistry WebBook, *Thermophysical Properties of Fluid Systems* (<https://webbook.nist.gov/chemistry/fluid/>):
isotherms at 293.15 K for nitrogen (C7727379), oxygen (C7782447) and helium (C7440597), density in mol/L every 10 bar
from 1 to 351 bar, fetched on 2026-10-08. Z = p / (density × R × T), R = 0.0831446 bar·L/(mol·K).

| Z at 20 °C | 51 bar | 101 bar | 201 bar | 231 bar | 301 bar |
|---|---|---|---|---|---|
| Oxygen | 0.9681 | 0.9461 | 0.9393 | 0.9473 | 0.9808 |
| Nitrogen | 0.9940 | 1.0011 | 1.0525 | 1.0760 | 1.1410 |
| Helium | 1.0247 | 1.0486 | 1.0956 | 1.1096 | 1.1418 |

The server's tests work their expected figures from this table by hand, not from the fit.

## The fit
Z = 1 + a·p + b·p² + c·p³ (p in bar), least squares through the 38 points per gas, by
[`scripts/fit-compressibility.mjs`](../../scripts/fit-compressibility.mjs) (run it to repeat the fit; it needs the network).

| Gas | a | b | c | Worst error |
|---|---|---|---|---|
| Oxygen | −7.698130e-4 | 2.362918e-6 | −9.607164e-11 | 0.20 % |
| Nitrogen | −2.850092e-4 | 3.167268e-6 | −2.215000e-9 | 0.07 % |
| Helium | 4.869641e-4 | −6.053372e-8 | 2.456439e-11 | under 0.01 % |

A mix is the sum by its fractions (air as 21 % oxygen, 79 % nitrogen): the fit gives 1.0290 at 201 bar and 1.1070 at 301 bar, the table mixed by hand 1.0287 and 1.1074. Above
351 bar the code keeps Z at its value there. In code: `apps/server/src/dives/real-gas.ts`.

## Why not Subsurface's coefficients
Subsurface (`core/gas-model.cpp`, `gas_compressibility_factor`) uses the same form: a cubic per gas, mixed linearly,
fitted by a contributor to tables in Perry's Chemical Engineers' Handbook at about 300 K, clamped to 0–500 bar
(<https://raw.githubusercontent.com/subsurface/subsurface/master/core/gas-model.cpp>, read 2026-10-08). The file is
GPL-2.0 and Dive Hub is Apache-2.0 ([ADR 0006](../decisions/0006-license-apache-2-and-fit-parser.md)), so the numbers
were not copied; the form of the model is common knowledge. Its values for air, computed from its coefficients, are
1.036 at 200 bar and 1.112 at 300 bar; ours are 1.028 and 1.106. Part of the difference is the temperature (300 K
against 293 K), part its oxygen fit, which is about 2 % above NIST's at 200 bar.

## Not verified
- **Mixing by fractions** is an approximation (it ignores how unlike molecules interact). No NIST table for air or a
  nitrox was fetched to measure the error; the WebBook lists pure fluids.
- **Temperature:** the fit is one isotherm. A cylinder in cold water holds more at the same pressure than the figure says.
- A Dive Gear Express article on Z factors for scuba could not be opened (HTTP 403); a search snippet of it gave a
  lower value for air at 232 bar (1.044) than NIST's pure gases mixed (1.049 at 231 bar). Not resolved.
- Published virial coefficients (Dymond & Smith, CRC Handbook) were not looked up.
