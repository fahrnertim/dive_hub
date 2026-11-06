@AGENTS.md

## Claude Code specifics

- Subagents in `.claude/agents/`: `researcher` (Sonnet, web research), `code-search` (Haiku, finding places in the
  repository) and `architecture-review`.
- Don't create `.claude/settings.local.json` entries or other local-only config that carries project knowledge.
