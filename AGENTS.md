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
git history on every push and pull request. `.github/workflows/ci.yml` runs the same gate as
parallel jobs on every pull request and push to main: static checks and unit tests on Ubuntu, and
the e2e suite sharded 4 ways per browser on Windows (Edge and Chrome are preinstalled), joined by a
final `check` job. `.github/workflows/pages.yml` deploys main to GitHub Pages after CI passes.
`.github/workflows/release.yml` is started by hand from main with the version: a read-only job
checks that CI passed on that commit, that `package.json` and a new `## [version]` section in
`CHANGELOG.md` match, and builds `sim.html`; a second job, which runs no npm code, rebuilds the
notes from that commit (`.github/scripts/release-notes.sh`), checks the build against the digest
the first job reported, tags the commit `v<version>` and publishes the GitHub Release with
`sim-<version>.html` and its SHA-256. Rerunning a failed publish job resumes without re-tagging.
Actions are pinned to commit SHAs.

## Layout

```
sim.html            Vite entry page (output: dist/sim.html)
src/main.ts         App bootstrap and shell (New/Open/Save file/Save As, status line)
src/session/        Dataset session, logical saved checkpoint, and file-operation ownership
src/db/             SQLite (sql.js) engine, dataset create/open validation, markings
src/db/migrations/  Forward-only schema migrations (PRAGMA user_version)
src/domain/         Repository (the only write path), entity types, validation, IP/FQDN detection
src/file/           File System Access API with download/upload fallback
src/ui/             Workspace UI: list panel, editor, form model (forms.ts), DOM helpers, CSS
src/map/            Map view: graph model (graph.ts, pure), Cytoscape + fcose view, map style, PNG/SVG export
src/demo/           Fictional UNCLASSIFIED demo enterprise, built through the repository
src/scenario/       To-Be scenarios: applyScenario and compareScenario (pure) over a snapshot
src/import/         CSV import: parser (csv.ts), templates, and the engine that writes through the repository
tests/helpers/      Node test helpers (sql.js WASM loading, schema inspection, dataset to CSV rows)
tests/unit/         Unit tests that are not colocated (e.g. build-output checks)
e2e/                Playwright tests that open dist/sim.html from file://
.codearbiter/       Project governance: context, decisions, specs, plans, work items
```

## Module boundaries

- `src/domain/repository.ts` is the only write path to a dataset. UI and the CSV importer
  write through it. Accepted CSV import runs inside `repository.atomic()`, so an import commits
  or rolls back as one undo step and one change event; its preview runs the same engine on a
  throwaway copy of the dataset. The map reads `repository.snapshot()`; its only write is node positions,
  which it hands to a `savePositions` callback that the workspace turns into one `setPositions`
  call. Writes are validated, run in a transaction, and fire `subscribe()` listeners only on
  success; `setPositions` writes and notifies nothing when no position changed.
- Undo/redo lives in the repository: temporary triggers on every table log the SQL that reverses
  each change, and one write is one step (`History`: `own`, `merge` into the write just before,
  or `none`). Temporary objects never reach the saved file. A migration that adds a table gets
  triggers automatically; a unit test checks every table is covered.
- Refusals are `ValidationError` (`code`, `field`, readable message). Text that looks like an
  IP address or host name raises `SensitiveInputWarning`; repeat the call with
  `{ confirmSensitive: true }` only after the user confirms (decision Q-032).
- **Migrations are forward-only.** Never edit a migration that has been merged; add a new one
  to `src/db/migrations/index.ts`. Each runs in a transaction with its `user_version` bump.
- UI code builds DOM with `src/ui/dom.ts` (`el`, `button`, `option`); never HTML strings.
  The editor uses Apply changes for existing records and type-specific Add for creation.
  Existing-service fields, support tiers, consumers, and outgoing dependencies share one
  staged draft and one atomic repository command; Discard changes restores that draft.
  Save file applies a valid active draft before capturing file bytes. Repository change events
  refresh projections without rebuilding a form the user is typing in.
- The map turns `repository.snapshot()` into elements with the pure `buildGraph` (unit-tested; e2e
  reads the canvas through Cytoscape's `_cyreg` registry on the `map-canvas` container, never a
  global). Repository changes update elements in place. Nodes sit at their saved positions; new or
  re-parented nodes are placed by fcose with every other leaf pinned; Re-layout re-runs it on everything.
  Scenario and compare views draw `applyScenario` / `compareScenario` snapshots and never write positions.
  Chain highlight (`traceChain`) and filters (`filterGraph`) are pure functions in `graph.ts`; the view
  re-applies them as classes after every sync, so they survive edits and drags, and they never write.
- Opened `.sqlite` files are untrusted: `openDataset` checks header, `application_id`
  (`SIM1`), version, integrity, foreign keys, and unsafe integer identities, and caps size at
  100 MB. Safely representable legacy semantic issues may be admitted unchanged; opening a
  file does not silently repair or rewrite it.
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
- **No dedicated IP-address or FQDN fields.** Host-like text in free-text fields triggers
  `SensitiveInputWarning` and may be saved only after explicit confirmation of the listed
  values (decomposition Q-032). A warning is not a guarantee that the dataset contains no
  classified data.
- **Fictional test data only.** Fixtures, demos and tests use synthetic UNCLASSIFIED data.
  Never commit real customer data.
- The classification banner always shows the highest marking present.
- TypeScript is pinned to 6.0.x because typescript-eslint does not yet support 7.x.

## Governance

This repo uses codeArbiter. Read `.codearbiter/` before larger changes: decisions in
`decisions/` (ADR-0001: stack), approved scope in `decomposition/project.html`, spike
findings in `spikes/`. Work happens on branches; `main` receives changes only by merge.
