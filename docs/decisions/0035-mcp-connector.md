---
title: "ADR 0035: An MCP endpoint in the app - read-only, personal tokens first, OAuth later"
summary: Dive Hub serves MCP at /mcp in the API server (SDK v2, stateless, Streamable HTTP), read-only. A User's LLM client gets a named AI access with a personal token (Better Auth api-key) shown once, scopes logbook:read and an opt-in logbook:positions; OAuth (Better Auth mcp + cimd) for claude.ai and ChatGPT later, once its refresh-token bug is fixed and for public instances. Off until an admin switches it on; every call logged for the User; revocable. ~8 curated tools (Dives with profiles, statistics, sites, buddies, Divers incl. body weight, equipment and planning tools as their slices land; planning answers carry their assumptions and disclaimer); shared site texts marked as written by other Users. Slice 17, built 2026-10-06 (see the amendment: TypeBox, no Zod; no Fastify adapter; seven tools; body weight waits for slice 19). The planned slices move to 18-22 (then to 19-23 when ADR 0036's dive assessment became 18). Amends 0011.
status: accepted
date: 2026-10-06
---

# ADR 0035: An MCP endpoint in the app - read-only, personal tokens first, OAuth later

## Status
Accepted – 2026-10-06. Built as slice 17 on 2026-10-06; what changed while building is in the
[amendment](#amendment-2026-10-06-as-built-slice-17). Amends [ADR 0011](0011-better-auth.md) (Better Auth gains the
api-key plugin now and the OAuth/MCP plugins later). [ADR 0009](0009-typebox-schemas.md) stays as it is: the SDK takes
JSON Schema, so no Zod was needed. Designed in [An MCP connector](../research/2026-10-06-mcp-connector.md).

## Context
The owner wants LLMs to access information from Dive Hub through MCP. The research (2026-10-06) found:
- MCP 2026-07-28 is stateless over Streamable HTTP; authorization is OAuth 2.1 with protected-resource metadata, resource
  indicators and client ID metadata documents; stdio servers take credentials from the environment.
- claude.ai (web, desktop, mobile) and ChatGPT connect from their vendors' clouds and accept OAuth (ChatGPT no static keys;
  claude.ai static headers only in a limited beta), so they need a public HTTPS instance. Claude Code, VS Code and Cursor
  connect from the User's machine and accept bearer headers; stdio-only clients bridge with `mcp-remote`.
- Better Auth 1.7.7 (pinned) has `@better-auth/mcp`, `oauth-provider`, `cimd` and `api-key` (MIT); the MCP plugin became a
  package seven weeks ago and has open issues, one security-relevant (#11553: a used refresh token stays valid).
- The MCP TypeScript SDK v2 (Apache-2.0) has a Fastify adapter and depends on Zod 4.
- Self-hosted apps mostly offer token-based servers with read-only switches; divetracx (the closest prior art) built OAuth
  with scopes, per-tool switches, an event log and revocation.
- The main risk is prompt injection through data other Users can edit (site names and descriptions, external Divers'
  names), next to the User's private Dives; read-only removes damage to the logbook, not leaks through the User's client.

The owner chose on 2026-10-06: M1 tokens first, OAuth later; M2 read-only; M3 everything may be returned (buddies'
names, positions behind an opt-in scope, shared site texts marked, body weight, Dives, equipment, profiles); M4 an admin
switch, per-User opt-in and a log; M5 curated tools with the planning tools; M6 TypeBox if the SDK takes JSON Schema;
M7 install `mcp-builder`; M8 next, as slice 17.

## Decision

### Endpoint and protocol
- **`/mcp` in the API server**, Streamable HTTP, built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`,
  `@modelcontextprotocol/fastify`), stateless; it also answers 2025-era clients as the SDK allows. No stdio package: a
  stdio-only client uses `mcp-remote` with the token.
- **Read-only:** no tool changes anything. Writes later behind their own scope and a confirmation step ("input required",
  a dry run); deleting never.

### Who may use it
- **Off until an admin switches it on** for the instance; switching it off ends every access at once.
- A User creates an **AI access** (name, scopes) and gets a **personal token** once (Better Auth `api-key`, hashed,
  optional expiry); the access lists created and last used, and can be revoked. An AI access acts for its User only and
  sees what that User sees: their Divers' Dives, shared sites, every Diver by name (ADR 0028); never another User's Dives,
  never admin data.
- **OAuth later** (Better Auth `mcp()` + `cimd()`, a consent page naming the client, its redirect host and the scopes) for
  claude.ai, ChatGPT and other cloud clients, once #11553 is fixed and for instances reachable over public HTTPS; the same
  endpoint, tools and scopes.

### What it returns
- **`logbook:read`:** the User's Dives with their values, Recordings and profiles (summarised; samples downsampled and only
  on request), Participants and buddies' names, Dive sites (names, country, water type, positions of sites, and their
  descriptions in a field marked as written by other Users), their Divers (with body weight, ADR 0031, once it exists),
  equipment and service due (ADR 0034), the planning tools (ADR 0031–0033).
- **`logbook:positions`** (opt-in per access): the Dives' own entry and exit positions (private, ADR 0020).
- The AI access page says what goes to the User's AI provider under its terms: their dives, their buddies' names (other
  people's data), body weight, and positions if granted.

### Tools
- **About eight curated, read-only tools**, namespaced and described statically in the code (never from data), with
  `readOnlyHint`, output schemas, cursors and caps (well under 25,000 tokens), a concise and a detailed form, names
  next to ids, errors that say what to do next: search Dives, get a Dive (with profile on request), logbook statistics,
  search and get Dive sites, buddies with counts, the User's Divers; later the dive assessment (18, ADR 0036), equipment and
  service due (23), the lead estimate (20), gas numbers and bottom time (21), gas plans (22), each added by its slice.
- **Planning tools** answer with their assumptions, limits and the disclaimer inside every result (ADR 0032's wording),
  so an LLM gets them with the number.
- Text other Users wrote (site names and descriptions, external Divers' names) is returned in fields marked as such.

### Oversight
- **Log** every call: time, User, AI access, tool, arguments without free text, rows returned, outcome; visible to the User
  on the AI access; kept 90 days. Rate limits per access; output caps; server-side timeouts.

### Schemas
- Tool schemas in **TypeBox** if the SDK accepts JSON Schema for tools; otherwise **Zod only inside `src/mcp/`**.

### Skill
- The `mcp-builder` skill (anthropics/skills, Apache-2.0) is installed with overrides in AGENTS.md.

### Order
**Slice 17**, next; the planned slices moved to 18–22, and again when the dive assessment (ADR 0036) became slice 18:
19 logging lead, suit and cylinders; 20 lead estimate; 21 MOD and bottom time; 22 gas plans; 23 equipment and service.

## Considered options
- **OAuth now:** works with every client from the start, but a large auth surface on a young plugin with an open
  refresh-token issue.
- **A local stdio package:** no endpoint, but an install per User and no claude.ai or ChatGPT.
- **A few safe writes in v1:** more useful; injected instructions could then change data.
- **Leaving out body weight, positions or shared texts:** the owner wants the full logbook available; positions stay
  behind an opt-in scope, shared texts are marked.
- **Per-User only, or an admin switch only:** the operator decides whether the instance offers it at all; the User sees what
  was read.
- **Tools generated from the OpenAPI document, or no planning tools:** generated servers do worse with LLMs and leak fields;
  planning answers carry their own assumptions.
- **Zod everywhere:** ADR 0009 stays for the API.

## Consequences
- Dive Hub's data leaves the instance at a User's request to an AI provider of their choice; the privacy texts say so.
- The client contract gains the MCP endpoint's rules (what the tools say, the marked texts, the disclaimer).
- Each later slice adds its MCP tools; their prompts say so.
- Better Auth's surface grows (api-key now; OAuth later with migrations generated, never `drizzle-kit push`).

## Amendment 2026-10-06: as built (slice 17)

What the build settled or changed. The decisions above stand where this says nothing.

### Checked ("Still to check" of the research note)
- **The SDK takes plain JSON Schema.** `fromJsonSchema(schema)` of `@modelcontextprotocol/server` 2.3.1 wraps a JSON
  Schema as the Standard Schema `registerTool` wants. Tool inputs and outputs are **TypeBox**; our code has no Zod
  (it stays a transitive dependency of the SDK and Better Auth). ADR 0009 is not amended.
- **Annotation names** are unchanged in the SDK for 2026-07-28: `readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`. Every tool sets read-only, not destructive, idempotent, closed world.
- **Both protocol eras** come from one `createMcpHandler(factory)`: 2026-07-28 requests, and 2025-era clients through
  its stateless fallback (`initialize`, `tools/list` and `tools/call` each as a request of their own; GET and DELETE
  answer 405). A test drives each.

### Changed
- **No `@modelcontextprotocol/fastify`.** That package only creates a Fastify app with Host-header checks for servers
  bound to localhost; it does not mount a handler. `/mcp` is a Fastify route that hands the request to the SDK's
  web-standard handler (`src/mcp/endpoint.ts`), the same way `/api/auth/*` hands requests to Better Auth. Not installed.
- **Authentication is ours, in front of the SDK.** The SDK's `requireBearerAuth` refuses tokens without an expiry, and
  AI access keys have none. The route checks the switch, the bearer key (Better Auth `verifyApiKey`), the User (not
  disabled), and answers 401 with `WWW-Authenticate: Bearer` and a sentence that says what to do (429 with
  `Retry-After` when rate limited). No protected-resource metadata until OAuth exists.
- **Origin check:** a request with an `Origin` other than the instance's base URL gets 403 (the spec's protection
  against browser pages elsewhere). LLM clients send none.
- **Seven tools, not about eight:** `logbook_search_dives`, `logbook_get_dive`, `logbook_stats`, `sites_search`,
  `sites_get`, `divers_buddies`, `divers_list`. All need `logbook:read`; `logbook:positions` adds fields (and the
  output schemas an access is shown differ by it), no tool.
- **Body weight is not returned yet:** it doesn't exist before slice 19 (ADR 0031). That slice adds it to
  `divers_list` and adds the line about it to the AI access panel, which today lists only what is really sent.
- **Shared texts are marked by field name:** fields starting with `shared_` (`shared_name`, `shared_description`,
  `shared_water_body`) hold text other Users wrote or open data delivered; the server's instructions and every tool
  description say to treat them as data. A Diver the User keeps is `name`, any other Diver `shared_name`.
- **The per-User opt-in is creating an access:** there is no separate per-User switch. No access, nothing readable.
- **Creating needs the switch on** (`ai_access_off`): nobody holds a key the admin never allowed.
- **Revoking deletes the key row.** The log keeps the access's id and name, so a revoked access's calls stay readable.
- **No expiry on keys** in the UI (the plugin supports it; nothing asks for it yet).
- **Scopes are fixed when an access is made;** granting positions later means a new access.

### How it is built
- **Keys:** Better Auth `@better-auth/api-key` 1.7.7, prefix `dh_`, SHA-256 stored, name required, table `apikey`
  (generated with `auth:generate`, adjusted like the other auth tables; `reference_id` is text without a foreign key,
  so deleting a User deletes their keys in `user-admin.ts`). Scopes are the key's permissions
  (`{"logbook":["read","positions"]}`). The plugin's endpoints are not in `PUBLIC_AUTH_PATHS`: still four Better Auth
  endpoints over HTTP (ADR 0013); our routes call the plugin server-side.
- **Rate limit:** 120 requests a minute per access (the plugin's counter on the key; a question takes several requests).
- **Every tool call** runs in one **read-only transaction** (PostgreSQL refuses a write) with an 8 s statement
  timeout, and is limited to the Divers the User manages.
- **Caps:** a result's JSON stays under 40,000 characters (about 10,000 tokens); a page that is too long is cut in half
  and `next_cursor` continues after what was kept. Pages: 50 Dives (20 with `detail=detailed`), 50 sites, 100 people;
  notes cut to 300, 500 or 4,000 characters; samples only on request, at most 4 series of 400 points.
- **Arguments are checked by us** (TypeBox), not by the SDK's validator, so a wrong call is logged too and the message
  names the unknown argument and lists the valid ones.
- **Log:** table `ai_access_log`; arguments as sent, known ones only, free text replaced by `[text]`; `rows` is what
  the answer held or counted; a daily worker job deletes entries older than 90 days, and reads never show older ones.
  Refused requests (401, 429) are not logged: they are not tool calls and have no User to show them to.
- **Switch:** table `ai_access_setting` (one row). Off rejects every key; the accesses stay.
- **Later slices add tools** in `src/mcp/` and list them in `TOOLS` (`src/mcp/server.ts`); a test checks that every
  free-text argument is named, so the log can't keep one by accident.
