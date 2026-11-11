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

## CI

`.github/workflows/secrets-scan.yml` runs gitleaks 8.30.1 (checksum-pinned) over the full
git history on every push and pull request. Actions are pinned to commit SHAs.

## Layout

```
sim.html            Vite entry page (output: dist/sim.html)
src/main.ts         App bootstrap and shell (New/Open/Save/Save As, status line)
src/db/             SQLite (sql.js) engine, dataset create/open validation, markings
src/db/migrations/  Forward-only schema migrations (PRAGMA user_version)
src/domain/         Repository (the only write path), entity types, validation, IP/FQDN detection
src/file/           File System Access API with download/upload fallback
tests/helpers/      Node test helpers (sql.js WASM loading, schema inspection)
tests/unit/         Unit tests that are not colocated (e.g. build-output checks)
e2e/                Playwright tests that open dist/sim.html from file://
.codearbiter/       Project governance: context, decisions, specs, plans, work items
```

## Module boundaries

- `src/domain/repository.ts` is the only write path to a dataset. UI and the CSV importer
  write through it; the map reads `repository.snapshot()` and never writes. Writes are
  validated, run in a transaction, and fire `subscribe()` listeners only on success.
- Refusals are `ValidationError` (`code`, `field`, readable message). Text that looks like an
  IP address or host name raises `SensitiveInputWarning`; repeat the call with
  `{ confirmSensitive: true }` only after the user confirms (decision Q-032).
- **Migrations are forward-only.** Never edit a migration that has been merged; add a new one
  to `src/db/migrations/index.ts`. Each runs in a transaction with its `user_version` bump.
- Opened `.sqlite` files are untrusted: `openDataset` checks header, `application_id`
  (`SIM1`), version, integrity and foreign keys, and caps size at 100 MB.
- Only `src/main.ts` imports the WASM (`?url`); `src/db` stays environment-neutral so Node
  tests and Playwright fixtures can use it with `configureSqliteWasm` or an explicit `wasm`.
- The SQLite WASM is imported with `?url` (not `?inline`; Vite 8 on Windows cannot load it
  that way) and passed to sql.js as `wasmBinary`. Never `fetch()` it.

## Rules

- **No network, ever.** No CDN, telemetry, update check or remote font. Everything is
  inlined at build time. `sim.html` carries a Content Security Policy (`connect-src 'none'`,
  security-controls CON-006) and the e2e suite fails on any non-`file:` request or CSP violation.
- **Prohibited primitives are lint errors in `src/`** (security-controls FACT-002): `eval`,
  `new Function`, string timers, network APIs, browser storage, `document.cookie`/`write`,
  `innerHTML`/`outerHTML`/`insertAdjacentHTML`, and `Math.random` (use `crypto.getRandomValues`).
  Build DOM with `textContent`/`createElement`. Any exception needs a justified
  `eslint-disable` comment and an override entry.
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
