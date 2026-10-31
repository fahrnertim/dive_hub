/** What a caught value says, for a stored failure detail or a log line: an Error's message, anything else as text. */
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
