# Connected UX verification

## Checked subject

Same branch `codex/sim-f26-recovery`, same PR24. Receiving F26 commit
`a70d59843cf295d9405d7570b7221112d9d82666`, reviewed main pin
`a8a330c66f4b075dedc6e40c17fb122359a77fe3`. `SOURCE-IDENTITY.json` binds the current
source, tests, build inputs and help by SHA-256. The delivery commit and exact-head
hosted CI are reported on PR24; this document does not substitute for those checks.

Working directory for all local commands:
`C:\Users\brenn\.codex\worktrees\sim-f26-recovery\SIM`.

Implementation source commit: `a5a780ee5ccded86c55372002b298d9739a1238d`. The subsequent delivery-docs commit changes no application or test source.

## Observed local evidence

- `npm run check`: exit 0, typecheck, lint, Prettier, single-file build, **342 unit tests and 280 Edge/Chrome browser tests**. Log: `%TEMP%\sim-connected-check-complete.log`. This run preceded the final additional initial-route refusal test.
- `npx playwright test e2e/connected-acceptance.spec.ts`: **14 browser executions passed**, including that final refusal case, actual UI save/reopen and multi-relation Undo/Redo. Named supporting cases are mapped in `EXECUTION-STATUS.json`.
- A subsequent full gate passed **342 unit and 282 browser tests**, including the initial invalid-route refusal. Log: `%TEMP%\sim-connected-check-delivery.log`.
- The final strict audit added complete child Cancel/Escape, fresh confirmation and three populated relationship headings, plus double Back focus, physical map Stay selection and virtual planned-route provenance. All **42/42** affected browser tests passed after three observed navigation defects were corrected.
- **Final subject: `npm run check` exit 0, 342 unit tests and 296 browser tests passed.** Typecheck, lint, formatting and build passed. Log: `%TEMP%\sim-connected-check-final-subject.log`. All 73 cases have individual evidence and final revalidation. Build SHA-256: `370d6c0d26dd801cf5b0e1c1885d717f61097c37254999e0b867b482f8de9fd1`.
- Independent scoped review: **PASS**, no remaining HIGH/CRITICAL finding. Reviewer independently ran six Edge/Chrome browser tests and six initial-service unit tests. See `REVIEW-NOTES.md` for defects reproduced and corrected.
- Numeric line/branch coverage is **unmeasured**, under the recorded no-tooling declaration `CTX-TECH-STACK#FACT-002`. Test totals are not coverage percentages or proof of every case; individual assertions are mapped separately.

## Negative controls and corrections

Actual failing regressions preceded the complete warning collector, stale support acknowledgement protection, typed route diagnostic metadata, peek heading focus, child ARIA references, export progress, former-CDS provenance and suspended-filter capture labels. The independent reviewer reproduced the stale Back/Open cross-session race before its guard correction. Invalid initial route creation now verifies parent retention and zero partial service/history writes. Invalid final-state CDS routes verify the stored dataset is unchanged; a corrected route and rehome apply together. Pure-focus mutation copies detected reversed direction, missing network crossing selection and an omitted CDS segment.

An earlier full integration run had six failures: two new tests used corrupted literal separators, and the new-service aggregate showed update wording. Correcting those tests and restoring accurate creation feedback gave 34/34 focused Edge/Chrome passes. A proposed foundational summary test initially assumed chain highlight revealed every shared-provider consumer; its oracle was corrected to assert the actual remaining hidden route, without changing production traversal.

The earlier F26 hosted run `43454187781` failed one Edge recovery content poll (193/194 passed). Its loop repeatedly transferred and decoded the full SQLite file. The test now waits for the mock's completed-close write counter, then decodes once and retains the same content assertion and timeout. Independent review passed this synchronization correction; the focused recovery suite passed **8/8**. Exact-head hosted CI remains the evidence for runner behavior.

## Capture and offline evidence

The suite opens the built single HTML via `file://`, offline, using installed Edge and Chrome. Build/CSP/lint tests and request monitoring enforce the no-network/browser-storage boundary. No dependency, migration or runtime persistence primitive was added.

Actual As-Is, To-Be and Compare PNG/SVG downloads and page images at **1600x1000** and **1024x768** are preserved in
`%TEMP%\sim-connected-evidence-20261113\final-green-296`.
`VISUAL-EVIDENCE.json` records their full paths and hashes. The integrator inspected current As-Is and Compare PNGs and Chrome rasterizations of the actual SVG exports at laptop size: complete route, qualified labels, focus/filter disclosure, legend, full SECRET or TOP SECRET synthetic caveat banners, no clipping. Earlier scoped author visual review inspected the wide/laptop projected matrix. The same tests regenerate the captures; these local images are synthetic test evidence, not screen-reader certification or native picker evidence.

A direct top-level SVG full-page screenshot timed out in the review harness. Rendering the unchanged SVG through a local image wrapper succeeded; no export bytes were altered.

## Native acceptance and delivery boundaries

The user's earlier Chrome Save, edit/save, Save As, cancel and reopen/readback test passed. They did not encounter a permission prompt. That evidence predates F26 and this increment.

**Still owner-pending:** real optional recovery file writes, reload/crash readback, two-process external-file conflict behavior and permission refusal if the browser presents it. Automated file tests use picker/handle stubs. No file lock, cross-process atomic compare-and-swap or power-loss durability is claimed. Follow `F26-RESUME.md` and `RESUME.md` for the native checkpoint. No merge or release is authorized.
