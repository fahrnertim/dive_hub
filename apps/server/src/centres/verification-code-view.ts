// A verification code over HTTP (ADR 0043): on a Dive centre, and in a Dive's line of codes.
import { Type } from 'typebox';
import { CENTRE_SOURCES } from './centre-service.js';

export const VerificationCodeView = Type.Object({
  provider: Type.Enum([...CENTRE_SOURCES]),
  text: Type.String({ description: 'Draw this text, unchanged, as a QR code; never build or parse it (docs/spec/clients.md)' }),
}, { description: 'The code a diver scans in the Provider\'s app so that it shows a dive as verified (ADR 0043). Not a secret' });
