// SSI's verification codes as text (ADR 0043): a Dive centre's is built from number and name; a pasted text is read
// as a centre's, a buddy's or a professional's. Placeholders only, never a real code.
import { describe, expect, it } from 'vitest';
import { centreCodeText, readVerificationCode } from '../src/centres/verification-code.js';
import { ssiCentreDisplayName } from '../src/providers/ssi/ssi-centre.js';

describe('a Dive centre\'s SSI verification code', () => {
  it('is "center;<number>;name:<name>", the name exactly as given', () => {
    expect(centreCodeText('700001', 'Example Divers GmbH, Musterstadt')).toBe('center;700001;name:Example Divers GmbH, Musterstadt');
  });
});

describe('the display name of an SSI centre', () => {
  it('is the name without the town SSI puts after the last comma', () => {
    expect(ssiCentreDisplayName('Example Divers GmbH, Musterstadt')).toBe('Example Divers GmbH');
    expect(ssiCentreDisplayName('Example Divers, Sub & Co., Musterstadt')).toBe('Example Divers, Sub & Co.');
  });

  it('is the whole name when there is no comma, or nothing before it', () => {
    expect(ssiCentreDisplayName('Example Divers')).toBe('Example Divers');
    expect(ssiCentreDisplayName(', Musterstadt')).toBe(', Musterstadt');
  });
});

describe('reading a pasted code', () => {
  it('knows a centre\'s, with a name that has commas, colons and semicolons', () => {
    expect(readVerificationCode(' center;700001;name:Example Divers GmbH, Musterstadt\n')).toEqual({
      kind: 'centre', centreNumber: '700001', name: 'Example Divers GmbH, Musterstadt',
    });
    expect(readVerificationCode('center;700002;name:A; B: C')).toEqual({ kind: 'centre', centreNumber: '700002', name: 'A; B: C' });
  });

  it('gives back the text it was built from', () => {
    const text = centreCodeText('700003', 'Tauchbasis Beispiel');
    const read = readVerificationCode(text);
    expect(read).toEqual({ kind: 'centre', centreNumber: '700003', name: 'Tauchbasis Beispiel' });
  });

  it('knows a buddy\'s and, by its leader number, a professional\'s', () => {
    expect(readVerificationCode('buddy;1234567;firstName:Erika;lastName:Mustermann;email:erika@example.com')).toEqual({
      kind: 'buddy', accountId: '1234567', firstName: 'Erika', lastName: 'Mustermann', email: 'erika@example.com',
    });
    expect(readVerificationCode('buddy;1234567;firstName:Erika;lastName:Mustermann;email:erika@example.com;leaderNr:54321')).toEqual({
      kind: 'professional', accountId: '1234567', firstName: 'Erika', lastName: 'Mustermann', email: 'erika@example.com', leaderNumber: '54321',
    });
  });

  it('refuses what it doesn\'t know', () => {
    for (const text of ['', 'site:3314', 'center;abc;name:X', 'center;700001', 'center;700001;name:  ', 'buddy;x;firstName:A', 'https://example.com']) {
      expect(readVerificationCode(text), text).toBeNull();
    }
  });
});
