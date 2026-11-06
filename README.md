# dive_hub

A self-hosted hub for divers: collects dive data from sources like Garmin and
Suunto, and can forward it to connected services like SSI.
See the [spec](docs/spec/README.md).

## Documentation

All project knowledge lives in this repository ([why](docs/decisions/0001-all-project-knowledge-in-repo.md)).
Start at **[docs/index.md](docs/index.md)**.

AI agents: see [AGENTS.md](AGENTS.md).

## Try it (development)

```sh
cp .env.example .env
docker compose -f compose.dev.yaml up -d
pnpm install
pnpm --filter @dive-hub/server dev   # API on :3000
pnpm --filter @dive-hub/web dev      # open http://localhost:5173
```

## Tests

The tests need PostgreSQL, so start it first if it is not running:

```sh
docker compose -f compose.dev.yaml up -d
pnpm test                            # unit and component tests
pnpm --filter @dive-hub/web test:e2e # browser tests (builds the web client)
```

While working, `pnpm check` runs the type check, lint and only the tests affected by the changed files. CI runs
the full suite (`pnpm check:full`) on every pull request. Details: [development guide](docs/development.md).

Licensed under [Apache-2.0](LICENSE).
