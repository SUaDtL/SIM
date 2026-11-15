# MAP author final scoped report

Owned changes are only `src/map/map-view.ts` and new `e2e/action-map.spec.ts`. Branch remains `codex/sim-usability-redesign`, HEAD `7fe6f8f49377e52144012d9c1c8c90f3c1adc087` plus the integrated working changes. No build, commit, dependency, native artifact, schema or dataset writes were performed by this author.

Current qualified focused artifact: SHA256 `18b1d4a09ff1b6f62eee0985f276525a48f23d8916d884d1dd0f8d794bb8288e` (root build3).

Source hashes at the run: map-view `1cc3b9cbcfb36ecb93d5d74f48abf11e3d624a44c1cb3b24970cace2376002a8`; action-map tests `e9100979b81acb358b584c3cab722697f610715ef9f439d9595a4b6b7b40665f`; app.css `c9a7d1ce7271e4211e776a2dc7079753a9a21f08455bce3fdca95ceddd795bf5`; workspace `6477a557ebb93382680b028a31d9d3d41f416b2c3f797f22f6fafa38ae1c0e30`.

## ACT-UX-16

Accepted graph navigation schedules a minimal pan once the inspector's resized canvas is measured. The pending node is handled after `cy.resize()` by ResizeObserver or the next animation frame, and consumed once. It uses the current rendered node body bounds, never Fit or node positions. The frame checks navigation intent/session, selection mismatch clears a pending target, and reset/restore/projection switch/reveal cancel pending work. Back can therefore restore an exact historical viewport while a resize callback is queued. No navigation admission or capture ownership was bypassed.

The genuine bug-origin RED is the root-owned canonical `Actual right-edge node click remains visible after opening its inspector without moving the node`, both hosts in `canonical-red.log` on baseline HTML SHA `4b508dd0715bc0febcd25c8ac267973d7ac9733281438fdbe9e454a84173475e`. This author read the exact Expected true / Received false failures before production changes. Root owns its canonical rerun.

Fresh build3 actual pointer checks pass both hosts: selected world position `(500, 0)` and zoom `1.1` stay unchanged; a canvas width of1366 becomes966, pan `(570, 180)` becomes `(372.2, 180)`, and the selected node body right edge is942 =966−24. Y pan stays180. Back restores pan `(570, 180)`, width1366 and zoom1.1 exactly after two render frames. An actual edge-node click refused with Stay preserves that complete viewport and draft `Orders pending`. Both observations retain JSON under `map-green-build3-results/action-map-Accepted-canvas-*`.

The author's earlier `map-viewport-baseline` / `map-viewport-characterization` pan failures are **invalid defect RED**: `showMap()` intentionally did nothing when Map was already visible, so the previous inspector stayed open and the supposed edge fixture was only966px wide. They are retained as harness history and never replace the genuine canonical RED. The final fixture actually clicks Map to park the inspector and explicitly asserts1366px before the canvas click. Its subsequent GREEN is additional behavioral proof.

## ACT-COV-01 Find family

`map-find-final-ledger-build3.json` retains76 explicit action observations, four readability geometry records and four viewport/draft readbacks with actual evidence paths. These are repeated automated browser observations, not distinct-control counts or numeric coverage. Every requested Find source entry has explicit evidence in **Chrome and Edge at1366 and320 CSS pixels**:

| Source | Actual observed variants |
| --- | --- |
| SOURCE-25 | Blank query, unmatched query, populated duplicate-name results, input resetting a paged query, result/query clearing after acceptance |
| SOURCE-26 | Partial Enter refusal, exact fully qualified Enter acceptance, ArrowDown into results/reopening dismissed results, Escape preserving query/input focus |
| SOURCE-27 | ArrowDown/Up movement and both list boundaries, first-row ArrowUp to query, result Escape to query, actual Enter activation |
| SOURCE-41 | Pointer `Directory (Blue) · service`, keyboard `Directory (Amber) · service`, exact-input `Orders (Amber)`; accepted heading/network/type distinguish typed identities |
| SOURCE-42 | Pointer `Beacon · category`, keyboard `Beacon · organization` among same-named application/category/organization results; accepted organization has the expected Orders(Amber) provided-service relationship |
| SOURCE-43 | Previous pointer and Enter activation, first-page disabled state, exact page identities/count, five actual Tab presses from the first result of a five-result last page to Previous |
| SOURCE-44 | Next pointer and Enter activation, last-page disabled state, exact page identities/count and first-result focus after paging |

Inside query/result focus transitions keep the transient surface open; actual outside Fit action and canvas presses dismiss it without clearing the query. Input/result Escape and reopening are explicitly exercised. Pointer result activation is actual Playwright click; keyboard activation is actual Enter. The Next keyboard test focuses its button as setup; Previous keyboard reachability uses actual Tab traversal. These distinctions are retained in the ledger rather than presented as a human study.

Final rendered screenshots were inspected: readable `dir` query, distinct Amber/Blue choices below the toolbar, bounded scrollable narrow paging, exact Blue service summary and Beacon organization summary. The long narrow result page scrolls; its Previous control remains reachable by Tab and pointer. Final selected graph and non-map keyboard observation rows focus the opened H2 (`Service: Directory` / `Organization: Beacon`) in both hosts/widths. No BODY focus was promoted to UX success.

### New findings exposed while closing coverage

ACT17: the baseline narrow query input was27.5px wide, effectively exposing its native clear button instead of readable text. `Find query has a readable text area and remains within the viewport` failed both narrow hosts with27.5 vs required160 before the READ author's CSS change; wide baseline169px passed. The original middle-click probe cleared the native search input at narrow width and is retained in `map-find-baseline.log`; using x8 for an actual text-area click corrected that harness action, without certifying readability. First integration CSS made the input readable but left the old fixed popup position over it: both hosts genuinely failed the unchanged input/result-boundary click because the popup intercepted it. READ's grid-row2 popup anchor fixes that regression. Final geometry: wide302.15625px; narrow288px atx16..304; final actual text-area click passes with popup open.

Accepted Find completion focus: current-ledger review exposed removed result triggers leaving BODY despite correct typed identities. The new named `accepted keyboard Find restores focus to the opened graph or non-map record` genuinely failed all four host/width cases on build2 SHA0997 (inactive already-focusable H2). `map-find-completion-focus-red.log` retains those failures. Root repaired shared accepted Find completion in workspace, including the same-record branch; the unchanged named test and ordinary typed-target observations pass on build3. This is an ACT06 disappearing-trigger completion-family extension, independently discovered during coverage closure.

## Actual checks and integration boundaries

All commands ran from `C:\Users\brenn\.codex\worktrees\sim-f26-recovery\SIM`.

- `npx eslint src/map/map-view.ts e2e/action-map.spec.ts`: PASS after final changes.
- `npx prettier --check src/map/map-view.ts e2e/action-map.spec.ts`: PASS after final changes.
- Build3 `npx playwright test e2e/action-map.spec.ts e2e/map-find-dismissal.spec.ts e2e/connected-navigation.spec.ts e2e/connected-navigation-acceptance.spec.ts e2e/connected-projection.spec.ts --workers=2 --output=<TEMP>/map-green-build3-results`: **66/66 PASS**, including24 owned host cases and42 preserved host cases; log `map-green-build3.log`.
- Build2 additionally ran all existing `e2e/map.spec.ts` guards successfully, including saved-position placement, no-write filters, frozen PNG after dataset replacement, synchronous export failure recovery and SVG. Its all-suite outcome was94/96 because both projection-acceptance cases exposed a workspace Unicode arrow becoming mojibake. Root corrected that source string; those unchanged projection cases pass on build3. Build2 capture results remain specifically bound to build2 SHA0997; root's full current check owns final all-suite qualification.

No remaining MAP implementation need is known. Root still owns full `npm run check`, combined independent review, governance/changelog, exact-head hosted CI, PR delivery and any merge/release decision. No hosted success or publication is inferred from these local focused checks.

No numeric lines/branches are measured; context tech-stack explicitly declares no numeric coverage provider. No native OS chooser/picker/permission, native palette, physical close/reload prompt, assistive device or human participant qualification was attempted. The previously stopped Windows native route remains stopped. File fixture setup is isolated Playwright automation, not native picker proof. All fixtures are fictional UNCLASSIFIED and every browser run uses the offline built file.
