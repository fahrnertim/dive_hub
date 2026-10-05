# AGENTS.md

Instructions for AI coding agents (any tool) working in this repository.

## Rule #1: all project knowledge lives in this repository

- Every piece of project information — spec, decisions, references to other
  projects, research, conventions, "things worth remembering" — goes into a file
  in this repo and gets committed. See [ADR 0001](docs/decisions/0001-all-project-knowledge-in-repo.md).
- **Never** use local, per-user or account-specific memory for this project:
  no `~/.claude/projects/*/memory/`, no `~/.claude/CLAUDE.md`, no
  `CLAUDE.local.md`, no equivalent memory features of other tools.
- **Never** store project information only in external services (Claude Docs,
  Google Drive, artifacts, chat history). If something is published externally,
  its source must also be committed here.
- If you learn something worth keeping, write it into `docs/` (and update
  [docs/index.md](docs/index.md)) instead of "remembering" it.
- When a user asks you to "remember" something, put it in the repo and say where.

## Where things are

Start at [docs/index.md](docs/index.md) — it lists every document.

| Folder | Contents |
|---|---|
| `docs/spec/` | Product specification |
| `docs/glossary.md` | Domain language (created with the first term) |
| `docs/decisions/` | ADRs (`NNNN-title.md`, copy `template.md`) |
| `docs/references/` | One file per external project/source |
| `docs/research/` | Dated research notes (`YYYY-MM-DD-topic.md`), sources linked |

## Conventions

- Markdown with YAML frontmatter: `title`, `summary`, `status`, `date`.
- Relative Markdown links (not `[[wikilinks]]`).
- Record significant decisions as ADRs; don't re-litigate accepted ones without a new ADR.
- **Checks** ([ADR 0023](docs/decisions/0023-faster-checks.md)): `pnpm check` while working (only what the change touches),
  `pnpm check:full` before proposing a commit, and the review capture with `REVIEW_AREAS` only when UI changed.
  A new page or module gets its path in `scripts/check.mjs`, and a new browser test gets an area tag.
- A change that gives API clients a new duty (something to show, ask, format or send) updates the
  [client contract](docs/spec/clients.md) in the same change.
- Keep this file short; details belong in `docs/`.

## Skills

Project skills live in `.claude/skills/` (installed with `npx skills add … --copy`,
pinned in `skills-lock.json`). Don't edit them; override here instead.

**Rule: check for skills before new work.** Before starting anything new (a new area,
design, or implementation with a new technology), search for specialized skills
(`npx skills find <topic>`, [skills.sh](https://skills.sh/)). Vet them (source reputation,
installs, repo activity, read the SKILL.md), propose the good ones to the user, and
install only with their approval, at project level. Record the outcome — installed or
rejected, and why — in [docs/skills.md](docs/skills.md).

- **domain-modeling**: the glossary is `docs/glossary.md` (not root `GLOSSARY.md`);
  ADRs go in `docs/decisions/` using our [template](docs/decisions/template.md)
  (not `docs/adr/`). Its "offer ADRs sparingly" criteria apply.
- **tdd**, **codebase-design**: same paths — glossary is `docs/glossary.md`, ADRs are in
  `docs/decisions/`. Test and interface names use the glossary's terms.
- **vercel-react-best-practices**: our web client is a Vite SPA, not Next.js. Ignore the
  `server-*` rules (React Server Components, server actions).
- **tanstack-query-best-practices**: community skill, not from TanStack; official docs win on conflict.
- **better-auth-\***: follow [ADR 0011](docs/decisions/0011-better-auth.md). Run the auth CLI at the
  project's pinned version (not `@latest`), generate into its own schema file, never `drizzle-kit push`
  (migrations are generated, reviewed and committed), and don't run `npx auth mcp`.
- **frontend-design**: our product is an app, not a landing page; ignore the "hero" guidance. The brief is
  [docs/spec/design-system.md](docs/spec/design-system.md) and the tokens in `apps/web/src/design/tokens.css`:
  extend them, don't restyle single pages.
- **accessibility**: target WCAG 2.2 AA; build on the React Aria components in `apps/web/src/ui/`.
- **playwright-cli**: tests live in `apps/web/e2e` and run with `pnpm --filter @dive-hub/web test:e2e` (every test has an area tag, [ADR 0023](docs/decisions/0023-faster-checks.md))
  (installed Edge/Chrome; don't run `npx playwright install`). Keep tests at the User's level: roles,
  labels and visible text, not CSS classes. A new page or state gets a case in `e2e/ui-quality.spec.ts`
  ([page rules](docs/spec/design-system.md#rules-every-page-follows)).
- **emil-design-eng**: skip its fixed opening line; write findings in our review documents' format
  (its Before/After table is fine inside them). Motion respects `prefers-reduced-motion` and the
  duration tokens in `apps/web/src/design/tokens.css`.
- **mobile-native**: skip its fixed opening line. Keep pull-to-refresh (no `overscroll-behavior: none` on `html`/`body`):
  the logbook is a scrolling document. Hover rules stay in `@media (hover: hover)` as `source-rules.test.ts` checks.
  Its "test on real hardware" step needs the owner's phone; say what could only be checked in emulation.
- **review-animations**, **find-animation-opportunities**: reduced motion means our `--duration-*` tokens
  drop to 0 (not "gentler, not zero"), until an ADR says otherwise. Map their Base UI/Framer examples to
  React Aria (`data-placement`, `--trigger-anchor-point`) and plain CSS transitions. Findings go in our
  review documents' format.
- **ux-tables**, **ux-inputs-and-forms**, **ux-empty-states**, **ux-menus**, **ux-loaders-and-progress**,
  **ux-notifications-and-toasts**, **ux-search**, **ux-selection-controls** (uxcel): the design system and React Aria win on conflict. Row actions
  stay visible (never hover-only); no truncate-plus-tooltip on phones; notices and toasts can always be
  dismissed, and errors never time out (WCAG 2.2.1, 4.1.3). Skip their hand-offs to `ux-*-audit` skills
  and orchestration docs we don't have, and their mobile push and marketing parts. ux-search's placement rules
  (a search bar on every page) are for site search, not for pickers and list filters.
- **suggest-lucide-icons**: a name must also exist in the installed `lucide-react` version (check
  `node_modules/lucide-react`), not only in `@latest`. Run its script as `PYTHONUTF8=1 python …` (Windows' default encoding fails). New icons go into the
  map in `apps/web/src/ui/Icon.tsx` ([ADR 0018](docs/decisions/0018-icons-and-motion.md)). Icons are
  `aria-hidden`; the control keeps its visible text or `aria-label`.
- **email-and-password-best-practices**: same rules as better-auth-\* (never `npx auth@latest migrate`; use
  `auth:generate` + drizzle-kit). Keep our argon2id parameters (m = 19 MiB, t = 2, p = 1) and 15-character
  minimum from [ADR 0012](docs/decisions/0012-invitations-and-admin-bootstrap.md), not the skill's example values.
- **better-layout**, **better-typography**, **better-colors** (jakubkrehel): our tokens and hex notation stay (no oklch rewrite).
  Their hand-offs to `better-accessibility`, `better-ui` and `better-writing` go to our `accessibility` skill, `emil-design-eng`
  and the writing rules in [docs/spec/design-system.md](docs/spec/design-system.md#writing). Surfaces follow
  [ADR 0019](docs/decisions/0019-tonal-surfaces.md): tones, not shadows, on the page. Findings go in our review documents' format.
