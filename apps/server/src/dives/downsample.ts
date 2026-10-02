/**
 * Reduces a series to about `maxPoints` points by keeping the minimum and maximum of each bucket,
 * so depth peaks survive. Full resolution stays in the database (data-sync research).
 */
export function downsampleMinMax(offsets: number[], values: number[], maxPoints: number) {
  if (values.length <= maxPoints || maxPoints < 4) return { offsets, values };
  const buckets = Math.floor(maxPoints / 2);
  const size = values.length / buckets;
  const outOffsets: number[] = [];
  const outValues: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size);
    const to = Math.min(values.length, Math.floor((b + 1) * size));
    let min = from;
    let max = from;
    for (let i = from; i < to; i++) {
      if (values[i]! < values[min]!) min = i;
      if (values[i]! > values[max]!) max = i;
    }
    for (const i of min <= max ? [min, max] : [max, min]) {
      if (outOffsets.at(-1) !== offsets[i]) {
        outOffsets.push(offsets[i]!);
        outValues.push(values[i]!);
      }
    }
  }
  return { offsets: outOffsets, values: outValues };
}
