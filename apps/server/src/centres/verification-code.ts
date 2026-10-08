// SSI's verification codes as text (ADR 0043, formats in docs/references/ssi-app-api.md): what a QR code a diver
// scans in SSI's app says. A Dive centre's is built here from its number and name and never stored; a pasted text is
// read here. The format stays on the server: clients draw the text and send pasted text back.

/** An SSI centre number: digits only (owner, 2026-10-08). */
export const CENTRE_NUMBER_PATTERN = /^[1-9]\d{0,9}$/;
/** What a User may type or paste for it: the bare number, or a centre's whole code. */
export function typedCentreNumber(typed: string): string | null {
  const value = typed.trim();
  if (CENTRE_NUMBER_PATTERN.test(value)) return value;
  const read = readVerificationCode(value);
  return read?.kind === 'centre' ? read.centreNumber : null;
}

/** The centre's code. The name goes in exactly as stored: whether SSI's app checks it is unknown. */
export const centreCodeText = (centreNumber: string, name: string) => `center;${centreNumber};name:${name}`;

export type VerificationCode =
  | { kind: 'centre'; centreNumber: string; name: string }
  | { kind: 'buddy'; accountId: string; firstName: string; lastName: string; email: string }
  | { kind: 'professional'; accountId: string; firstName: string; lastName: string; email: string; leaderNumber: string };

/** What a person's codes are built from: their SSI account and what SSI's own code says about them (a Diver's fields). */
export interface CodePerson {
  accountId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  leaderNumber: string | null;
}

/** What a part of a person's code may be: one line without the semicolon that ends a part. */
export const CODE_PART_PATTERN = /^[^;\r\n]+$/;

/**
 * A person's codes: the buddy code, by which another diver adds them to their SSI buddy list, and with a leader number
 * also the professional's code, which verifies a dive. Nothing while account, a name or the e-mail is missing: the code
 * is always the one SSI itself would show (ADR 0043).
 */
export function personCodes(person: CodePerson): { kind: 'buddy' | 'professional'; provider: 'ssi'; text: string }[] {
  const { accountId, firstName, lastName, email, leaderNumber } = person;
  if (!accountId || !firstName || !lastName || !email) return [];
  const buddy = `buddy;${accountId};firstName:${firstName};lastName:${lastName};email:${email}`;
  return [
    { kind: 'buddy', provider: 'ssi', text: buddy },
    ...(leaderNumber ? [{ kind: 'professional' as const, provider: 'ssi' as const, text: `${buddy};leaderNr:${leaderNumber}` }] : []),
  ];
}

const BUDDY = /^buddy;([1-9]\d{0,9});firstName:([^;]*);lastName:([^;]*);email:([^;]*)(?:;leaderNr:([^;]+))?$/;

/** What a code's text is, with its fields; null for a text that is none of the known codes. */
export function readVerificationCode(text: string): VerificationCode | null {
  const value = text.trim();
  // The name is the rest of the text: it may hold any character, a semicolon too.
  const centre = /^center;([1-9]\d{0,9});name:(.*)$/s.exec(value);
  if (centre) {
    const name = centre[2]!.trim();
    return name && !/[\r\n]/.test(name) ? { kind: 'centre', centreNumber: centre[1]!, name } : null;
  }
  const buddy = BUDDY.exec(value);
  if (!buddy) return null;
  const [, accountId, firstName, lastName, email, leaderNumber] = buddy;
  const person = { accountId: accountId!, firstName: firstName!.trim(), lastName: lastName!.trim(), email: email!.trim() };
  return leaderNumber === undefined ? { kind: 'buddy', ...person } : { kind: 'professional', ...person, leaderNumber: leaderNumber.trim() };
}
