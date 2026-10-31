// A position over HTTP: on a Dive site, and where a Dive's Recording placed it.
import { Type } from 'typebox';

export const PositionSchema = Type.Object({
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
}, { additionalProperties: false, description: 'WGS84 degrees' });
