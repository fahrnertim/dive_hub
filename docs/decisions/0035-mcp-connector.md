---
title: "ADR 0035: An MCP endpoint in the app - read-only, personal tokens first, OAuth later"
summary: Dive Hub serves MCP at /mcp in the API server (SDK v2, stateless, Streamable HTTP), read-only. A User's LLM client gets a named AI access with a personal token (Better Auth api-key) shown once, scopes logbook:read and an opt-in logbook:positions; OAuth (Better Auth mcp + cimd) for claude.ai and ChatGPT later, once its refresh-token bug is fixed and for public instances. Off until an admin switches it on; every call logged for the User; revocable. ~8 curated tools (Dives with profiles, statistics, sites, buddies, Divers incl. body weight, equipment and planning tools as their slices land; planning answers carry their assumptions and disclaimer); shared site texts marked as written by other Users. Slice 17; the planned slices move to 18-22 (then to 19-23 when ADR 0036's dive assessment became 18). Amends 0011 and, if needed, 0009.
status: accepted
date: 2026-10-06
---

# ADR 0035: An MCP endpoint in the app - read-only, personal tokens first, OAuth later

## Status
Accepted – 2026-10-06. Not built yet. Amends [ADR 0011](0011-better-auth.md) (Better Auth gains the api-key plugin now
and the OAuth/MCP plugins later; the endpoints it exposes grow) and, only if the MCP SDK insists on Zod,
[ADR 0009](0009-typebox-schemas.md) (Zod inside the MCP module). Designed in [An MCP connector](../research/2026-10-06-mcp-connector.md).

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
