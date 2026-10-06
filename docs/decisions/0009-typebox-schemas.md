---
title: "ADR 0009: TypeBox for API schemas"
summary: API input and output are described with TypeBox (JSON Schema), which Fastify validates natively and turns into the OpenAPI description.
status: accepted
date: 2026-10-02
---

# ADR 0009: TypeBox for API schemas

## Status
Accepted – 2026-10-02. Amended by [ADR 0035](0035-mcp-connector.md) (planned, slice 17) only if the MCP SDK insists on Zod
for tool schemas: then Zod is allowed inside `src/mcp/`, nowhere else.

## Context
[ADR 0007](0007-fastify-http-framework.md) left the schema library open, to be decided with the
database library ([ADR 0008](0008-drizzle-database-access.md)). The schemas validate API input,
type the route handlers and produce the OpenAPI description from which clients are generated.

## Decision
- API schemas are written with **TypeBox**. Fastify validates and serialises with them natively, and
  `@fastify/swagger` turns them into OpenAPI without a conversion step.
- Where an API shape equals a table shape, it may be derived with `drizzle-typebox`. (As of 2026-10,
  `drizzle-typebox` still targets `@sinclair/typebox` 0.34 while Fastify's provider needs `typebox` 1.x,
  so schemas are written by hand until that is resolved.)
- Parsed file contents (e.g. FIT messages) are checked with TypeBox too, so there's one way of
  describing data on the server.
- The web client uses types from the generated OpenAPI client. Form validation in the web client
  is a separate, later choice.

## Considered options
- **Zod.** More popular, nicer syntax, common for React forms. Rejected for the server: it needs a
  community type provider and a conversion to JSON Schema, an extra layer where API description and
  validation can drift apart.

## Consequences
- What Fastify validates is exactly what the OpenAPI description says.
- TypeBox syntax is less familiar than Zod's.
- If the web client later uses Zod for forms, the two are linked only through the generated API types.
