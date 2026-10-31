// JSON as SSI sends it: the one place that turns its text into values. Callers decide what unreadable means.

/** JSON text as what it holds; undefined when it is not JSON (JSON itself never yields undefined). */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** A list SSI keeps as JSON text in a record field (`odin_user_log_diveSamples`, `…Dataset`), or one already parsed; null when empty, unreadable or not a list. */
export function storedList(v: unknown): unknown[] | null {
  const parsed = typeof v === 'string' ? tryParseJson(v) : v;
  return Array.isArray(parsed) ? parsed : null;
}
