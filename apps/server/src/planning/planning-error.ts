// How a planning calculation refuses (ADR 0032, 0033): the routes map the code through STATUS, the MCP tools through HINT.

export class PlanningError extends Error {
  constructor(readonly code: 'invalid_input' | 'gas_not_breathable' | 'diver_not_found' | 'site_not_found') {
    super(code);
  }
}
