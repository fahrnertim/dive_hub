// How SSI names a Dive centre (ADR 0043): "<name>, <town>", as its verification code spells it. The whole name is what
// Dive Hub stores, edits and writes into the code; this is the shorter name to show. Another Source may name differently.

/** The centre's name without the town after the last comma. The whole name when that leaves nothing. */
export function ssiCentreDisplayName(name: string): string {
  const comma = name.lastIndexOf(',');
  return (comma > 0 && name.slice(0, comma).trim()) || name;
}
