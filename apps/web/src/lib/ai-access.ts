// Copy-ready lines for adding Dive Hub's MCP endpoint to an LLM client (ADR 0035). The key is in them, so they
// are built only while a new key is on screen.

/** The name the endpoint gets in the client's list of MCP servers. */
const SERVER_NAME = 'dive-hub';

const isLocal = (endpoint: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname);

export function setupLines(endpoint: string, key: string) {
  const header = `Authorization: Bearer ${key}`;
  // mcp-remote refuses plain http unless the server is on this machine (or it is told otherwise).
  const allowHttp = endpoint.startsWith('http://') && !isLocal(endpoint) ? ' --allow-http' : '';
  return {
    /** A terminal command; Claude Code keeps the server in its own configuration. */
    claudeCode: `claude mcp add --transport http ${SERVER_NAME} ${endpoint} --header "${header}"`,
    /** The content of .vscode/mcp.json (or the "servers" entry to add to it). */
    vsCode: JSON.stringify({ servers: { [SERVER_NAME]: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${key}` } } } }),
    /** For clients that only start local servers: mcp-remote bridges to the endpoint. */
    mcpRemote: `npx -y mcp-remote ${endpoint} --header "${header}"${allowHttp}`,
  };
}

/** A log entry's arguments as one short line: "country: EG, limit: 5". */
export function argumentsText(args: Record<string, unknown>): string {
  return Object.entries(args).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join('+') : String(value)}`).join(', ');
}
