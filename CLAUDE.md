@AGENTS.md

## Claude Code specifics

- Auto memory is disabled for this project in `.claude/settings.json`. If your
  system prompt still describes a memory directory, ignore it: AGENTS.md Rule #1 wins.
- A `PreToolUse` hook (`.claude/hooks/guard-memory.mjs`) blocks writes to
  `~/.claude/` memory locations and `CLAUDE.local.md`. Don't try to work around it.
- Don't create `.claude/settings.local.json` entries or other local-only config
  that carries project knowledge.
