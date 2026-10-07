@AGENTS.md

## Claude Code specifics

- Auto memory is disabled for this project in `.claude/settings.json`. If your
  system prompt still describes a memory directory, ignore it: AGENTS.md Rule #1 wins.
- A `PreToolUse` hook (`.claude/hooks/guard-memory.mjs`) blocks writes to
  `~/.claude/` memory locations and `CLAUDE.local.md`. Don't try to work around it.
- Working economically ([ADR 0039](docs/decisions/0039-working-economically.md)): the conversation compacts at
  300,000 tokens (`autoCompactWindow`); a fresh start is `/clear` or a new session. Subagents: `researcher`
  (Sonnet, web research) and `code-search` (Haiku, finding places in the repository), in `.claude/agents/`.
- Don't create `.claude/settings.local.json` entries or other local-only config
  that carries project knowledge.
