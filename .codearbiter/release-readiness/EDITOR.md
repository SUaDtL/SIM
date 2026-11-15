# Editor release-readiness repair

Owned implementation: `src/ui/editor-panel.ts` and new `e2e/readiness-editor.spec.ts`. Root later explicitly assigned adapters in `e2e/acceptance-journeys.spec.ts` and `e2e/market-workspace.spec.ts`. Root owns shared workspace/summary integration, all builds, work IDs and delivery. No native dialogs, commits, native artifact writes or global formatting performed by this author.

## Implemented scope

- R01: Refuse shared Apply when a consumer or dependency chooser is unfinished. Preserve unrelated fields, focus a completion control and offer explicit composer cancellation. Add/Cancel recompute remaining composer intent, so completing one never clears another. The same Apply boundary protects Save, Apply-and-continue and Apply-and-capture. Completion guidance is also placed by the focused control rather than only in a distant form alert.
- R02: Changed route tasks contribute to pending work and block parent Apply until Use route or Cancel route. Route candidates survive unrelated relationship redraws through bounded per-provider state; re-created controls show the retained candidate. Cancel restores only the route task and retains independent changes.
- R03: Inspect staged dependencies through a snapshot built from the edited aggregate. Pending additions and changed routes show their actual selected route. Unchanged applied inspection continues to use the recorded snapshot. Context distinguishes pending, recorded history and projected state; root owns the inspector presentation.
- R08: Shared child creation derives the invoking parent noun, including organization-parent editing; independently created shared records remain explicit.
- R10: Use the shared structured read-only summary, including provider, purpose, Support and Connections. Removed Compare ghosts show clearly labeled current As-Is details, planned services retain origin metadata, and named before/after changes link to exact scenario changes. Human changes and actions stay within shared padding; metrics/effects are optional details; unresolved-route warnings stay visible. Related navigation remains origin-aware through root callbacks. Recorded ghost connections explicitly use recorded scope, never pending scope.
- R17: Capture and restore the actual edit body scroll owner. Existing read-summary restoration remains separate.
- R12 integration: Builder collection validation is shown in the builder before any metadata transaction, preserving existing invalid-builder/no-partial-write assertions.
- R16 twin: Unknown editor failure uses neutral protection guidance, never assumes rollback. A one-shot inspector-render failure after commit verifies exported renamed data survives.
- R18 copy: The scenario heading names name/description/unadded proposal. Concise immediate Add/Remove and cancellation guidance sits beside the scenario commands (scenario author owns that file).

## Regression evidence and corrections

Baseline app is the exact prior 883f9ba tree, merged as main55986ee2. `editor-red.log` establishes six meaningful Chrome failures: R01 consumer/dependency Apply completes without the selection; R02 route remains clean; R03 staged Inspect is inert; R08 wrong parent noun; R10 purpose absent. The seventh initial R17 attempt timed out at an unavailable Inventory row and is NOT defect proof.

`editor-scroll-red.log` uses supported Support -> related organization -> Edit organization -> Back and records lost inner scroll (0 versus 591). First GREEN restored 514 rather than the initially expected591 because clicking the related control itself legitimately scrolls77px before actual navigation. The final oracle captures after the peek opens and before Edit navigation, then checks exact return to that captured offset. This is an oracle timing correction, not a claim that the original591 assertion passed.

`editor-green1.log`: 10 pass, 4 fail. R10 remained parked after baseline selection -> Map -> Compare -> Find; root fixed the workspace ownership path. R17 timing correction described above. `editor-green1-expanded.log` reports28 pass but is retained as an ambiguous build epoch and not used as final qualification.

Stable build2 (SHA2567ca4aa1b351fd7ca5e71733f39a73f552eb50e47c110a3db9c30c8b7b2fc7d70): `editor-green2.log` exits0,36/36 host cases, with before/after unchanged artifact hash.

Stable build2 twins: `editor-twins-red.log` proves pending route UI disappears after another relationship addition and post-commit inspector failure falsely claims no change. The inspector fault was then rewritten from an overloaded createElement proxy to a one-shot Element.append hook to satisfy type/lint; `editor-inspector-red2.log` replays the same precise failure with persisted rename readback.

Stable build3 (SHA25673a2bb7b3701f7d5a3be0c44395a7bc4b5e885b3db30b18d8acd15fe5c59f61d): `editor-green3.log` exits0,64/64 host cases (48 new editor plus16 original scenario-builder), hash unchanged before/after. It includes all composer Add/Cancel interleavings, Save/navigation/Capture refusals, positive saved-byte readback, pending/applied inspection, four projection states, nested Support return, route redraw and post-commit protection.

Current presentation follow-ups after that run: `editor-cue-red.log` shows completion cue absent beside the focused control; baseline wide/narrow screenshots establish distant feedback. `editor-ghost-connection-red.log` proves a recorded removed-service connection had a truthful heading but a false Pending changes body. Source repairs are implemented and qualified by the final stable build4 run below.

## Evidence limits

These are isolated full built file:// Chrome/Edge app tests with synthetic data. File save uses upload/download fallback; no new native picker/permission, browser Close/Reload, native color selection, participant, release or publication acceptance is claimed. Overlapping focused test counts are not additive distinct-action counts. Root owns full npm run check, independent review, exact-head hosted CI and release qualification.

## Final stable build4 verification

Artifact SHA-256: `08ca35d822f99756b26db9aabab14649d85bf381238e8d9781466748d4084f47` (verified unchanged before and after run).

Command: `npx playwright test e2e/readiness-editor.spec.ts e2e/acceptance-journeys.spec.ts e2e/market-workspace.spec.ts --workers=1 --output=<TEMP>/editor-green4-results`.

Observed exit0, **72/72 Chrome/Edge cases passed** in56.6s: 50 host cases from25 new editor definitions plus22 retained legacy host cases. Log `editor-green4.log`. Separate earlier64-case builder/editor run is overlapping history, not an additive72+64 claim.

Scoped ESLint and Prettier checks on all four owned/assigned files passed after final run. Typecheck passed before root build4 and the current full check remains root-owned.

Visual review: both author and root inspected the production screenshots. `editor-green4-results/readiness-editor-R10-proje-46a22--named-before-after-context-msedge/projected-inspector-wide.png` shows one padded structured summary with named change and header actions. Its narrow counterpart preserves that structure. `editor-green4-results/readiness-editor-R01-Apply-c7c8a-e-until-explicitly-finished-msedge/unfinished-composer-narrow.png` shows the full completion instruction immediately above the focused Add dependency and explicit Cancel action. Consumer screenshots and both browser variants are also retained in the same run outputs.

The newly scoped ghost connection test confirms truthful Current As-Is heading, recorded route, no Edit consuming service, no Pending changes label and no repository write. Root carries the explicit recorded/projected/pending scope through the shared inspector.

Legacy adaptations preserve and strengthen the prior semantics: J7 checks visible service identity, qualified Network, Compare context, read-only state, appropriate Edit As-Is availability and named move/retirement/planned state; the tap still resolves the real baseline service and capture context. The scenario Save journey now makes the newly required deliberate network choice while retaining metadata/change saved-byte readback. The market projected count journey checks visible separate Connections collections, no outgoing rows, one incoming row and exact Backup (Coral) identity rather than old prose counts.

No outstanding author-owned source changes or running processes remain. Root is beginning the full gate and owns review, source integration, work completion and delivery.

## COV-R02-01 review follow-up (completed)

The aggregate `final-verdict.md` was read completely and its SHA-256 verified as `e763dc1b9d6d2074b2b2fdf19eaf0786fcbffe1bc133cd3a2640b5cd4e09894e`. Its bounded PASS retained two MEDIUM DEFERRABLE findings; the coordinator explicitly required repair rather than deferral. The fresh `route-review-author.json` caller input and counted delivery text were consumed. Existing R02 work identity `WORK-6D5B56DD2171B77965A11970DDC42E1D` was reused; no new native item or artifact was written by this author.

The source-causal finding was confirmed with four genuine offline Chrome RED cases against stable build5 SHA-256 `69c8269e8f42919f2421562b027859e98a64a5cc76c37e79cfdb4541cdbf1c53`: Apply/Save crossed with an excluding search/another dependency page. The synthetic fixture has25 dependencies. Provider24's route is changed to Second guard on the second page, then deliberately filtered or paged away. Apply/Save correctly refuses the write, but its actual route control is absent; all four fail the exact visible-route assertion. `editor-hidden-route-red.log` observed exit1; no unrelated setup failure was accepted as RED.

The minimal repair reuses `relationViews`, `serviceDraft.dependencies` and `renderRelations`. When the retained unfinished provider's control is not attached, refusal clears the excluding dependency query and computes that exact provider's page using the same explicit20-row size passed to `collectionPage`; the normal redraw reattaches its retained candidate. Existing cue/focus logic then focuses the actual route select beside Use route/Cancel route. No repository write, global controller or alternate workflow was added.

The four new regression definitions verify the retained Second guard candidate, exact provider identity, correct page controls, empty excluding query, focused real route select, no download/no Undo before resolution, then Use route or Cancel route and saved-file readback of all25 dependencies. Cancel retains First guard; Use records Second guard. They add8 browser host cases, so this file now contains29 definitions /58 host cases. These are not added to earlier overlapping run totals as distinct coverage.

Scoped TypeScript, ESLint and formatting passed after the repair. The coordinator's stable build6 SHA-256 `c819532d67b2d64df66decff75170c65c6eb9a90248fcf7a4764d0ac3cb587b7` ran all8 route host cases plus2 independently owned R12 provider-label cases: `review-findings-green.log` reports10/10 pass in7.1s, and root reports observed command exit0. This author read the complete retained log. The subsequent root full gate has already rebuilt dist with a fresh build metadata epoch, so the current dist digest is not mislabeled as that earlier build6 artifact.

Current author-owned follow-up paths are only `src/ui/editor-panel.ts` and `e2e/readiness-editor.spec.ts`. No further source edits or author test processes remain. Full gate2 and the affected independent review recheck remain coordinator-owned; no full-gate, hosted CI, native or release PASS is inferred from these focused results.
