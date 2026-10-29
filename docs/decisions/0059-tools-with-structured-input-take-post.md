---
title: "ADR 0059: A tool with structured input takes POST with a JSON body"
summary: A computed-on-request tool whose input has lists or objects is POST with a typed JSON body and a full response schema (POST /api/tools/gas-plan); a tool with only flat values stays GET with query parameters (/api/tools/gas, /api/tools/bottom-time).
status: accepted
date: 2026-10-29
---

# ADR 0059: A tool with structured input takes POST with a JSON body

## Status
Accepted – 2026-10-29 (owner's decision during the desloppify cleanup)

## Context
The Tools page's calculations ([ADR 0032](0032-mod-and-no-decompression-limits.md),
[ADR 0033](0033-gas-plans-rules-and-groups.md)) are computed on request and store nothing, so they were all `GET`.
The gas plan takes lists (levels, Divers), which `GET /api/tools/gas-plan` carried as JSON strings in the query: the route
parsed and checked them by hand, its response schema said only `status`, and the web client wrote the plan's types
itself and cast the answer through `unknown`. The contract was in prose only (docs/spec/clients.md), and a change on
the server could not break the client's build.

Alternatives: repeated query parameters (`level=20:20&level=5:3`) keep `GET` but invent a small syntax per field and
still need parsing by hand; keeping JSON in the query keeps the problem.

## Decision
- A tool whose input has lists or objects is `POST` with a JSON body, validated by its schema, and declares its full
  response schema. `POST /api/tools/gas-plan` replaces `GET /api/tools/gas-plan`; it still stores nothing.
- A tool whose input is only flat values stays `GET` with query parameters: `/api/tools/gas` and
  `/api/tools/bottom-time`.
- Clients take the request and response types from the generated OpenAPI client, not from types of their own.

## Consequences
- The gas plan's answer is typed end to end: the web client and the MCP tool read it without casts, and a change to
  the answer breaks their build instead of their screen.
- A gas plan cannot be bookmarked or cached as a URL; the Tools page keeps its inputs in its own address and sends the
  body from them, so nothing a User sees changes.
- The old `GET` is gone without a transition: the web client is the only HTTP client, and the MCP tool calls the plan
  service directly.
