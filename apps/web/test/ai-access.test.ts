import { describe, expect, it } from 'vitest';
import { argumentsText, setupLines } from '../src/lib/ai-access.ts';

describe('setup lines for an AI access', () => {
  const lines = setupLines('https://dives.example.com/mcp', 'dh_abc');

  it('gives Claude Code a command with the endpoint and the key as a header', () => {
    expect(lines.claudeCode).toBe('claude mcp add --transport http dive-hub https://dives.example.com/mcp --header "Authorization: Bearer dh_abc"');
  });

  it('gives VS Code a valid mcp.json', () => {
    expect(JSON.parse(lines.vsCode)).toEqual({
      servers: { 'dive-hub': { type: 'http', url: 'https://dives.example.com/mcp', headers: { Authorization: 'Bearer dh_abc' } } },
    });
  });

  it('lets mcp-remote use plain http only where it must be told to', () => {
    expect(lines.mcpRemote).toBe('npx -y mcp-remote https://dives.example.com/mcp --header "Authorization: Bearer dh_abc"');
    expect(setupLines('http://nas.local:3000/mcp', 'dh_abc').mcpRemote).toMatch(/ --allow-http$/);
    expect(setupLines('http://localhost:3000/mcp', 'dh_abc').mcpRemote).not.toContain('--allow-http');
  });
});

describe('a log entry\'s arguments', () => {
  it('reads as one line', () => {
    expect(argumentsText({ query: '[text]', country: 'EG', limit: 5, sample_channels: ['depth', 'temperature'] }))
      .toBe('query: [text], country: EG, limit: 5, sample_channels: depth+temperature');
    expect(argumentsText({})).toBe('');
  });
});
