/**
 * How dive computer makers spell themselves. Sources deliver identifiers (FIT: "garmin",
 * "shearwater"); unknown ones are shown with a capital first letter and spaces for underscores.
 */
const MANUFACTURERS: Record<string, string> = {
  garmin: 'Garmin', suunto: 'Suunto', shearwater: 'Shearwater', mares: 'Mares', scubapro: 'Scubapro',
  aqualung: 'Aqualung', cressi: 'Cressi', oceanic: 'Oceanic', ratio: 'Ratio', deepblu: 'Deepblu',
};

export function manufacturerName(id: string): string {
  const known = MANUFACTURERS[id.toLowerCase()];
  if (known) return known;
  const words = id.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Garmin Descent Mk3" */
export const deviceName = (manufacturer: string, product: string | null) =>
  product ? `${manufacturerName(manufacturer)} ${product}` : manufacturerName(manufacturer);
