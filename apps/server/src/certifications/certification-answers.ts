// How a Certification refusal is answered over HTTP: by the Certification routes and the Provider routes that import cards.
import { answers } from '../http/problems.js';
import { CertificationError } from './certification-service.js';

const STATUS: Record<CertificationError['code'], number> = {
  diver_not_found: 404, certification_not_found: 404, certification_image_not_found: 404,
  certification_changed: 409, certification_read_only: 409, invalid_input: 400,
};

export const replyCertificationError = answers(CertificationError, STATUS);
