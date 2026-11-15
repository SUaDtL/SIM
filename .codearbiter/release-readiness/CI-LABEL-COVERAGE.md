## Test Audit Review — 2026-11-15

Terminal state: DONE. Unit: coverage. Read-only bounded CI-label delta; no repository mutation or extra tests/builds were performed by this reviewer.

### Binding and admission
- Root: `C:\Users\brenn\.codex\worktrees\sim-f26-recovery\SIM`; HEAD: `3cfbbd4c9a1160d26bafc58416bf0293454fcb01`.
- Current source epoch: `d86dd6df565da6ccf4b541e723140754c23797526fbf42f1ea994ed09e8fd01b`; all 146 manifest files rehashed before the final report with zero mismatches.
- Current `ci-label.diff` exactly equals the three-path working diff. Actual AGENTS and ca-review/coverage-auditor/maturity-coverage/reviewer-contract were read. The freshly selected reviewer packet is ready with no missing refs/blockers; delivery packet `27a7b7db7fdad874efc8516ae5afeccd5b54ad52e06bb1accebb4ca1ffcf2cda` was consumed. Optional code map/provenance unavailable remains advisory.
- Scope: `src/map/map-view.ts`, `src/map/style.ts`, `e2e/layout-quality.spec.ts` only. Previous readiness review/evidence applies to unchanged previous scope; it does not stand in for this delta.

### Coverage
Profile: no numeric tooling configured | Scope: map label zoom sizing | Hosts: Windows Chrome and Edge observed / Chrome and Edge required
Required metrics: none under the explicit no-tooling exemption; stage 1 | Threshold: numeric floor inapplicable under exemption
Unmeasured: lines, branches | Critical-path evidence: applicable readability, leaf-position and existing layout/hover outcomes covered
Status: PASS for this bounded behavioral audit; no numeric percentage is claimed

The exact `CTX-TECH-STACK#FACT-002` / `.codearbiter/context/tech-stack.html` passage reads: "No numeric coverage command or provider is configured in package.json or Vitest configuration. Unit checks use npm test and browser checks use npm run e2e. Lines and branches remain unmeasured; no numeric coverage pass is claimed." `.codearbiter/CONTEXT.md` declares stage 1 and HTML context.

### Evidence and obligations
1. The genuine hosted symptom is retained in `hosted-failed.log`: at head 3cfbbd4 a network label measured 10.961160381810211px against the unchanged >=11px layout baseline (725 browser cases passed, one failed). Root cause is the base*2 model-space cap, not an assertion tolerance. Both network and CDS use that same cap.
2. The deterministic regression in `ci-label-red-qualified.log` failed on broken source: at zoom0.25 it observed network10/CDS8 against expected13/11. RED log SHA-256 `75dc446e664e4a2094d9d9e2bdb9ba91b5c8305356bf7b04bdf50fb707436ff8`. The final source retains that same screen-size oracle. The subsequent leaf-only position assertion correctly excludes compound network centers, which Cytoscape derives from child label bounds. Existing >=11px layout threshold, overlap/crossing/tiny-label assertions, and hover/zoom assertions are retained.
3. Both fixed zoom0.25 and0.125 exercise actual offline built app/Cytoscape. `applyZoom` now uses max(base,min/zoom); it retains base-size behavior above the minimum. Cytoscape minZoom0.1/maxZoom4 bounds effective model font size, so removing the old *2 cap does not admit division by zero or unbounded font growth in supported view state. The same growth helper fixes both affected entity classes.
4. The synchronous zoom path updates classes/font styles, not repository state or placement jobs. Stored service/CDS leaf positions are asserted unchanged. Compound centers can shift as their calculated boxes change; they are not independent placement records. Persistence is queued by layout/drag operations, not zoom. Existing map tests separately check saved state and no-write behavior.
5. PNG/SVG export calls applyZoom(true) using zoom*2 and restores screen styles in finally. For these minima, resulting model font size times the export pixel scale still gives the same declared minimum. Existing SVG tests cover a0.2 zoom, actual label content, styles, classification and saved state; map tests cover PNG and asynchronous failure/replacement behavior. No new export-only branch or write path was introduced. The current full local run has observed the Edge export tests passing; final exhaustive and hosted verdicts remain the coordinator's responsibility.

Observed scoped outcomes in `ci-label-full-check.log`:
```
  ok 188 [msedge] › e2e\layout-quality.spec.ts:131:1 › keeps a spike-sized map readable: few crossings and label overlaps, no overlapping networks (1.2s)
  ok 193 [msedge] › e2e\layout-quality.spec.ts:193:1 › network and CDS labels retain their readable screen size on wide map zooms without moving records (814ms)
  ok 196 [msedge] › e2e\layout-quality.spec.ts:253:1 › hides unreadably small service labels until hovered or zoomed into (1.5s)
  ok 552 [chrome] › e2e\layout-quality.spec.ts:131:1 › keeps a spike-sized map readable: few crossings and label overlaps, no overlapping networks (1.2s)
  ok 558 [chrome] › e2e\layout-quality.spec.ts:193:1 › network and CDS labels retain their readable screen size on wide map zooms without moving records (763ms)
  ok 561 [chrome] › e2e\layout-quality.spec.ts:253:1 › hides unreadably small service labels until hovered or zoomed into (1.5s)
```
The log was still growing when inspected. This report does not claim full `npm run check` or hosted exact-head success. Observed log prefix: 110914 bytes, SHA-256 `fca78ee6c7b6becdd60d72ef8fd8437933891d32df20585741fa26b4cc501dab`; the coordinator must read its terminal exit and final totals separately. The observed unit section reports393/393 passed; that is not a coverage percentage.

### CRITICAL findings (0)
None.

### HIGH findings (0)
None.

### MEDIUM findings (0)
None.

### LOW findings (0)
None.

### Gate status
PASS — no active findings in the bounded font-cap repair. DONE1 / ERRORED0 / DEFERRED0. This is a coverage review, not authorization or evidence for merge, publication, physical native dialogs, permission refusal or real participants. R05 publication, G01/G02 scoping, V03 geometry limits and V04 native/participant acceptance remain separate.
