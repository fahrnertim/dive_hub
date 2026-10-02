---
title: "ADR 0007: Fastify as HTTP framework"
summary: The API server uses Fastify on Node, with its official plugins for OpenAPI, uploads and cookies.
status: accepted
date: 2026-10-02
---

# ADR 0007: Fastify as HTTP framework

## Status
Accepted – 2026-10-02

## Context
[ADR 0005](0005-typescript-stack.md) left the HTTP framework open between Fastify, Hono and NestJS.
The framework handles routing, input validation, the generated OpenAPI description, uploads,
cookies, auth hooks, logging and serving the web client. Domain logic stays in our own modules.
Research: [server and web stack](../research/2026-10-02-server-and-web-stack.md),
[agent skills vetting](../research/2026-10-02-agent-skills-vetting.md).

## Decision
- The API server uses **Fastify** on Node LTS.
- The OpenAPI description is generated from route schemas (`@fastify/swagger`); the web client's
  API code is generated from it.
- Uploads, cookies and static files use the official Fastify plugins.
- Route handlers stay thin: they validate, call domain modules and map results to responses.
- The schema library is **TypeBox** ([ADR 0009](0009-typebox-schemas.md)); it was decided
  together with the database access library, since both should share one way of describing data.

## Considered options
- **Hono.** Light and web-standard, with Zod as one definition for validation, types and OpenAPI.
  Rejected: its edge-runtime strengths don't matter for a self-hosted Node app, and its agent skill
  is thin and fetches remote content.
- **NestJS.** Batteries included and used by Immich. Rejected: heavier, with more structure and
  decorators than a small team needs.

## Consequences
- We get the maintainer-written `fastify-best-practices` skill.
- Plugins and hooks need some wiring that NestJS would give us out of the box.
- Swapping the framework later means rewriting the route layer only, as long as handlers stay thin.
