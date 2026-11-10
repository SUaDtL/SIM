# AGENTS.md

Guide for AI agents and developers working on SIM (Service Integration Map).

SIM is a local-only, single-file HTML app for inventorying the services each network
domain provides and consumes, and visualizing how they connect. The build output is one
self-contained `dist/sim.html` that runs offline from `file://` with no server.

## Commands

| Command                | What it does                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`          | Vite dev server for local iteration (the shipped app never needs a server).              |
| `npm run build`        | Builds the single file `dist/sim.html` with all JS, CSS and SQLite WASM inlined.         |
| `npm run typecheck`    | `tsc --noEmit` under strict settings.                                                    |
| `npm run lint`         | ESLint with type-aware `strictTypeChecked` rules.                                        |
| `npm run format`       | Prettier rewrite.                                                                        |
| `npm run format:check` | Prettier check without writing.                                                          |
| `npm test`             | Vitest unit tests (`src/**/*.test.ts`, `tests/unit/`).                                   |
| `npm run e2e`          | Playwright against the built `dist/sim.html` via `file://`, offline, in Edge and Chrome. |
| `npm run check`        | The gate: typecheck → lint → format:check → build → test → e2e. Run before every commit. |

`npm run e2e` uses the installed Microsoft Edge and Google Chrome (`msedge` and `chrome`
channels). It does not download browsers.

## Layout

```
sim.html            Vite entry page (output: dist/sim.html)
src/main.ts         App bootstrap
src/db/             SQLite (sql.js) engine loading and database access
tests/unit/         Unit tests that are not colocated (e.g. build-output checks)
e2e/                Playwright tests that open dist/sim.html from file://
.codearbiter/       Project governance: context, decisions, specs, plans, work items
```

## Module boundaries

- `src/db/` owns the only write path to the dataset. UI and the CSV importer write through
  the domain repository; the map view reads and never writes.
- The SQLite WASM is imported with `?url` (not `?inline`; Vite 8 on Windows cannot load it
  that way) and passed to sql.js as `wasmBinary`. Never `fetch()` it.

## Rules

- **No network, ever.** No CDN, telemetry, update check or remote font. Everything is
  inlined at build time. The e2e suite fails on any non-`file:` request.
- **Never store IP addresses or FQDNs.** The data model has no fields for them; this keeps
  classified data out of SIM.
- **Fictional test data only.** Fixtures, demos and tests use synthetic UNCLASSIFIED data.
  Never commit real customer data.
- The classification banner always shows the highest marking present.
- TypeScript is pinned to 6.0.x because typescript-eslint does not yet support 7.x.

## Governance

This repo uses codeArbiter. Read `.codearbiter/` before larger changes: decisions in
`decisions/` (ADR-0001: stack), approved scope in `decomposition/project.html`, spike
findings in `spikes/`. Work happens on branches; `main` receives changes only by merge.
