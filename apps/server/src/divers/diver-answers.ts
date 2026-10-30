// How a Diver refusal is answered over HTTP: by the Diver routes and every route plugin whose services refuse a Diver.
import { answers } from '../http/problems.js';
import { DiverError } from './diver-error.js';

const STATUS: Record<DiverError['code'], number> = {
  diver_choice_needed: 409, diver_has_other_account: 409, code_not_recognised: 400, code_not_a_person: 400,
  diver_not_found: 404, own_diver: 409, diver_not_empty: 409, device_not_found: 404, diver_in_use: 409,
  diver_not_deletable: 403, diver_not_editable: 403, diver_external_id_taken: 409, diver_external_id_connected: 409, diver_not_external: 409,
  invalid_input: 400, body_weight_not_found: 404,
};

/** Answers a Diver refusal; with diver_external_id_taken, the Diver that has the account. */
export const replyDiverError = answers(DiverError, STATUS, (error) => error.diver && { diver: error.diver });
