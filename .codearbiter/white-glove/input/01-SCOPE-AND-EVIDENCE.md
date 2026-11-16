# Scope and evidence

## Subject and result

Repository: SUaDtL/SIM. Main `90d04afe422804b1922417cdc719dd7ff2e4dec8`; tree `4ac3883bbdb0c5b020cabde4a35f47c1ba107971`. PR 26 merged. The previous audit pin is not the current subject.

**Result: not qualified for end-user release by this review.** Nine findings/qualification gaps are recorded. This is not a claim that the entire app was used.

## What actually ran

The exact current picker, DOM helper, relationship collection and menu-dismissal controller were transpiled without logic changes and run in Chromium 144.0.7559.96 with the complete current app.css. Six complete production files, including the pure focus module, match Git blob identities. TypeScript 5.8.3 in the available harness removed type syntax; this is not the project's declared build toolchain or typecheck.

Twenty-one isolated browser functional checks passed. Three diagnostic observations recorded layout/selection metrics. Nine pure focus checks passed. A current hasPendingDraft excerpt was executed with controlled clean-parent, child-only, route, relation and contextual-default states. Those predicate observations do not reproduce native reload loss.

The component document was inline about:blank with synthetic adapters. The header was a source-matched DOM fixture, not booted main.ts. No database, Cytoscape renderer, save adapter, application export or complete scenario editor ran in that fixture. Screenshots are explicitly component/layout evidence.

## What did not run

No full repository gate, complete current offline HTML, integrated UAT matrix, current PNG/SVG output, real native Save/Save As/recovery/conflict, actual browser zoom, screen-reader session, or human focus group ran here. The 180 integrated cases remain not run. Synthetic role analysis is one reviewer's structured application of five task perspectives, not independent participants or statistical evidence.

## Why integrated UAT remained blocked

The checked CI run returned no retained build artifact. Current ci.yml has no artifact-upload step. Connected desktop/browser access was unavailable. Direct file:// navigation in the cloud browser was rejected by administrator policy, which was not overridden. Source and dependency retrieval could not produce an exact build in this session. Component rendering was used as a separately scoped activity, not as a disguised replacement app.

## External evidence

PR26 reports 393 unit tests and 728 Chrome/Edge browser executions, with run 43762954206 at its PR head. Treat these as repository-reported evidence until logs, assertions, tree identity and limits are checked. This reviewer did not rerun those tests, and their count is not full feature coverage or usability certification.

## Evidence levels

- Browser component/layout reproduction: observable in the supplied unchanged components and CSS; integrate before closing.
- Pure production-function execution: data/control semantics tested, not rendered UX.
- Source trace plus extracted predicate: candidate defect with deterministic code evidence; native or integrated reproduction explicitly outstanding.
- Qualification gap: missing proof, not automatically an application failure.
- Synthetic hypothesis: anticipated user misunderstanding, not an observed participant outcome.

No product source, GitHub state, user files or published release were changed. All execution data is fictional.
