// What a Diver operation refuses with (ADR 0016, 0028); its own file so the service and the merge both import it
// without importing each other (ADR 0053).
export class DiverError extends Error {
  constructor(
    readonly code:
      | 'diver_not_found' | 'own_diver' | 'diver_not_empty' | 'device_not_found' | 'diver_in_use' | 'diver_not_deletable'
      | 'diver_not_editable' | 'diver_external_id_taken' | 'diver_external_id_connected' | 'invalid_input' | 'diver_not_external'
      | 'diver_choice_needed' | 'diver_has_other_account' | 'code_not_recognised' | 'code_not_a_person' | 'body_weight_not_found',
    /** The Diver that already has an account (`diver_external_id_taken`), so a client can offer to use it instead. */
    readonly diver?: { id: string; name: string },
  ) {
    super(code);
  }
}
