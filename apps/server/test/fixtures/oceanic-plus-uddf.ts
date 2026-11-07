// Hand-made UDDF in the shape of an Oceanic+ logbook export (docs/references/oceanic-plus.md): its generator, ids like
// `dive_<24 hex>`, sites named by their id, one `air` mix, an offset written as `-00:04`, waypoints every 15 s with
// times as decimals. The values are our own; the public sample this shape was read from is GPL and stays outside.

export interface OceanicDive {
  id: string;
  /** Local wall-clock time as the app writes it, without the offset. */
  local: string;
  /** The offset as the app writes it (hours in the minutes' place). */
  offset: string;
  site?: { id: string; latitude: number; longitude: number };
  /** [seconds, metres, kelvin or undefined] */
  waypoints: [number, number, number | undefined][];
  greatestDepth: number;
  duration: number;
  lowestTemperature: number;
  rating?: number;
  /** Whether the app links a tank (default true): a dive without it has no gas and no Cylinder. */
  tankData?: boolean;
}

export const OCEANIC_DIVES: OceanicDive[] = [
  {
    id: '6a1f00c0ffee00000000beef',
    local: '2026-03-14T10:05:20.000',
    offset: '-00:04',
    site: { id: 'site_6a1f00c0ffee00000000beef', latitude: 18.3, longitude: -65.6 },
    waypoints: [[0, 0, undefined], [15, 0.4, 300.15], [30, 3.25, 300.05], [45, 7.5, 299.95], [60, 12.4, 299.85], [75, 8.1, 299.9], [90, 0.3, 300.0]],
    greatestDepth: 12.4,
    duration: 85,
    lowestTemperature: 299.85,
    rating: 8,
  },
  {
    id: '6a1f00c0ffee00000000cafe',
    local: '2026-03-14T13:40:00.000',
    offset: '-00:04',
    waypoints: [[0, 0, undefined], [15.0, 2.0, 300.15], [30.0, 0.2, 300.15]],
    greatestDepth: 2.0,
    duration: 30,
    lowestTemperature: 300.15,
  },
];

const site = (s: NonNullable<OceanicDive['site']>) => `
        <site id="${s.id}">
            <name>${s.id}</name>
            <geography>
                <location>${s.id}</location>
                <latitude>${s.latitude}</latitude>
                <longitude>${s.longitude}</longitude>
                <altitude>-1.0671948</altitude>
            </geography>
        </site>`;

/** The app writes every number with a decimal point ("15.0"), at full precision. */
const decimal = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

const waypoint = ([t, depth, k]: OceanicDive['waypoints'][number], first: boolean) => `
                    <waypoint>
                        <depth>${decimal(depth)}</depth>
                        <divetime>${decimal(t)}</divetime>${k === undefined ? '' : `
                        <temperature>${k}</temperature>`}${first ? `
                        <switchmix ref="air"/>
                        <divemode type="opencircuit"/>` : ''}
                    </waypoint>`;

const dive = (d: OceanicDive) => `
        <repetitiongroup id="repetition_group_${d.id}">
            <dive id="dive_${d.id}">
                <informationbeforedive>${d.site ? `
                    <link ref="${d.site.id}"/>` : ''}
                    <datetime>${d.local}${d.offset}</datetime>
                    <altitude>-1.0671948</altitude>
                </informationbeforedive>
                <samples>${d.waypoints.map((w, i) => waypoint(w, i === 0)).join('')}
                </samples>${d.tankData === false ? '' : `
                <tankdata id="tank_${d.id}">
                    <link ref="air"/>
                </tankdata>`}
                <informationafterdive>
                    <lowesttemperature>${d.lowestTemperature}</lowesttemperature>
                    <greatestdepth>${d.greatestDepth}</greatestdepth>
                    <diveduration>${d.duration.toFixed(1)}</diveduration>
                    <equipmentused>
                        <leadquantity>0.0</leadquantity>${d.tankData === false ? '' : `
                        <link ref="tank_${d.id}"/>`}
                    </equipmentused>${d.rating === undefined ? '' : `
                    <rating>
                        <ratingvalue>${d.rating}</ratingvalue>
                    </rating>`}
                </informationafterdive>
            </dive>
        </repetitiongroup>`;

export function makeOceanicPlusUddf(dives: OceanicDive[] = OCEANIC_DIVES): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<uddf version="3.2.1" xmlns="http://www.streit.cc/uddf/3.2/">
    <generator>
        <manufacturer>
            <contact>
                <homepage>https://www.oceanicworldwide.com/it/oceanic-plus/</homepage>
            </contact>
        </manufacturer>
        <version>0.0.1</version>
        <datetime>2026-03-20T08:00:00.000Z</datetime>
    </generator>
    <divesite>${dives.flatMap((d) => (d.site ? [site(d.site)] : [])).join('')}
    </divesite>
    <gasdefinitions>
        <mix id="air">
            <name>air</name>
            <o2>0.21</o2>
            <n2>0.79</n2>
        </mix>
    </gasdefinitions>
    <profiledata>${dives.map(dive).join('')}
    </profiledata>
</uddf>
`;
  return new TextEncoder().encode(xml);
}
