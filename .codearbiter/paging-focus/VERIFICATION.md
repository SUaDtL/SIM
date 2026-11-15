# Pagination focus — CI repair on PR25

Parent: `33c257d`. Native fix: `WORK-59653482C15FEE2852F24EA366D3772F`.

The hosted Windows run `43600854221` passed 388 unit tests and 459 browser checks, including the menu regressions. One Edge case expected Previous to retain focus after becoming disabled. Native disabled-button focus is not a reliable keyboard contract. The original handlers also provided no explicit handoff, leaving users on an inactive control or losing useful focus.

The required behavior is explicit: after a page changes, retain the activated button when enabled; at a first/last-page boundary move focus to the enabled opposite button. A shared DOM helper enforces that policy after rendering in all eight affected handlers: staged relationship lists, read-only relationship collections, checklist choices and CSV diagnostics. Inventory, reference-picker and map-search pagination already focus results and retain their existing behavior. There is no browser-specific branch, sleep, retry or timeout adjustment.

## Regression evidence

The existing test's two disabled-focus expectations were replaced with assertions for disabled state, enabled opposite control and useful focus. Its complete 25-ID coverage, unapplied-draft, saved snapshot, dependency count and Undo assertions remain. New checks exercise 45-item middle-page Enter/Space repetition, both boundaries, read-only collections and retained checklist choices. CSV checks now traverse forward/back/forward while preserving existing late-row, downloadable receipt, classification and commit/readback assertions.

Before implementation, eight editor/relationship/checklist focus checks and two CSV focus checks failed for inactive enabled targets; two unrelated empty-paging characterizations passed. After implementation all 18 focused Chrome/Edge checks passed. The final full `npm run check` exited 0: typecheck, lint, formatting, standalone build, 388 unit tests and 466 offline browser checks, including actual 200%/400% zoom.

`REGRESSION-RED.log`, `CSV-RED.log`, `REGRESSION-GREEN.log`, `LOCAL-CHECK.log` and `SOURCE-SHA256.json` retain the observed sequence and final source binding. Numeric line/branch coverage remains unmeasured under the declared `CTX-TECH-STACK#FACT-002` no-tooling exemption.

## Review and local checkpoint

One independent coverage-auditor unit reached DONE with no findings. It verified the manifest, precise RED/GREEN oracles, all eight call sites, retained data/draft/receipt assertions and the remaining pager implementations. Sequential finding-triage → verdict-aggregator returned PASS with zero findings or incomplete units. Prior menu findings belong to their earlier completed batch.

Open `C:\Users\brenn\Downloads\SIM-PR25-Checkpoints\06-menu-and-keyboard-focus.html` in Chrome or Edge. It matches the current `dist/sim.html`; the manifest records its digest. It includes the menu fix and this keyboard follow-up. On a multipage list, Next at the last page hands focus to Previous; Previous at the first page hands focus to Next. Middle-page activation stays on the usable control. Paging itself never writes data or creates history.

Native completion records implementation progress. Hosted CI for the eventual committed head is a separate qualification on PR25. Real-participant approval, native OS dialog/physical recovery checks, merge and release are not claimed.
