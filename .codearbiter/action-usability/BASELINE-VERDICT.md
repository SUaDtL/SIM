# Review verdict — comprehensive SIM action usability

**Verdict: INCOMPLETE. Aggregator terminal state: DONE.**

All four expected units (inspection, editing, shell, coordinator) are DONE and represented. The complete triage was the sole finding input; its SHA256 was verified as `2dffb683ec71b21780a97b4cb51a82672a2c68c2b89a2b5204a8c375e9772e48`. Raw reviewer reports, source and ledgers were not reread. No new product findings were introduced. The 20 original findings remain represented exactly once as 16 consolidated product findings, with ACT-COV-01 separately retaining the incomplete full-action accounting obligation.

| Disposition | Count |
| --- | ---: |
| BLOCKS | 0 |
| DEFERRABLE | 15 |
| NON_BLOCKING | 1 |
| INCOMPLETE_RESULT findings | 1 |

Product severities: 15 MEDIUM, 1 LOW; no asserted CRITICAL/HIGH. ACT-COV-01 is MEDIUM/INCOMPLETE_RESULT. Incompleteness takes precedence over PASS. These disposition labels do not authorize postponing the user-requested repairs. This is a baseline audit verdict, not fixed-source qualification, participant acceptance or authority to merge/release.

Triage terminal state: **DONE**. Review-completion state: **INCOMPLETE** because ACT-COV-01 remains; all four expected reviewer/coordinator units themselves returned DONE. This is not a product acceptance verdict.

Source `7fe6f8f49377e52144012d9c1c8c90f3c1adc087`, epoch `4e1291ea5f4c246d75ba9139ab2d47aa853b693c9f978875e778964b4b1f2ffc`, same branch/PR25. Built HTML SHA256 `4b508dd0715bc0febcd25c8ac267973d7ac9733281438fdbe9e454a84173475e`. Parent separately verified reviewed source/test hashes unchanged and has12 named expected RED host cases in `root-actions-red.log`; no repaired-source GREEN or final acceptance is inferred.

All input hashes below were verified before consumption. Inspection6 + editing5 + shell4 + coordinator5 = **20 original findings**. Four genuine duplicate pairs are merged, yielding **16 actionable product findings:15 MEDIUM and1 LOW**. No CRITICAL/HIGH security or integrity issue was asserted by these units. Controls are n/a (usability), except that remedies explicitly preserve existing security/data guards. No issue is dropped because its severity is deferrable. All16 remain requested repair work; this triage does not authorize postponement, merging, publication or an override.

Severity-contract dispositions: BLOCKS0; DEFERRABLE15; NON_BLOCKING1; INCOMPLETE_RESULT1 (ACT-COV-01). Incompleteness takes precedence for aggregation. Medium/low disposition labels do not mean user-approved deferral.

## Complete actionable table

Suggested ownership groups are file-integration boundaries, not implementation authority or a new framework requirement. NAV and EDITOR must coordinate their public section/cancel intent contract; only one author edits a shared file. Root remains integration owner.

| ID | Severity | Disposition | Original IDs retained | Suggested owner | Source location | Complete repair obligation | Evidence retained in the complete triage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACT-UX-01 | MEDIUM | DEFERRABLE | INS-01; NODE-ROOT-04 | NAV / editor API | src/ui/workspace.ts:298-325; src/ui/editor-panel.ts:121-139 | Successive service-node inspection resets Connections/Support to Overview. Both hosts, all three inspection widths; root independently corroborates. Carry same-kind read section into the next accepted service selection; preserve explicit Back, new-dataset and non-service/projected reset rules. This is an inferred task-efficiency expectation, not an asserted earlier promise. | inspection-followup-actions.json; root-node-observations.json |
| ACT-UX-02 | MEDIUM | DEFERRABLE | INS-02; NODE-ROOT-01 | READ / CSS | src/ui/record-summary.ts:411-418; src/ui/app.css:861-869,1351-1354 | More service actions reflows Edit/tabs and even moves its own trigger at320px. Wide Edit+20px/tabs+40px; narrow trigger left60px/down48px and tabs+88px in both hosts. Use stable anchored bounded action rows with destructive separation and viewport-safe reachability; preserve dismissal and launched-modal focus. Inferred context-menu usability expectation. | inspection-followup-actions.json; inspection-hit-observations.json; root-node-observations.json |
| ACT-UX-03 | MEDIUM | DEFERRABLE | INS-03 | NAV / editor API | src/ui/workspace.ts:468-479,591-598 | Connection inspector Edit consuming service lands in Details, and F2 from Support/Connections diverges from the visible Edit action. Pass explicit section intent through guarded shared editing navigation. Cover both entries, visible Edit parity, exact consumer identity and dirty-draft Stay. | inspection-actions-primary-raw.json; inspection-return-actions.json |
| ACT-UX-04 | MEDIUM | DEFERRABLE | INS-04; NODE-ROOT-02 | NAV | src/ui/workspace.ts:365-382; src/ui/editor-panel.ts:197-257 | Cancel/discard from Create similar makes the inspector disappear rather than returning to source Support/tab/query/context. Both hosts; source data itself remains unchanged. Capture origin through guarded navigation and restore it on caller-owned cancellation; preserve independent creation, support copying and session/draft choices. | inspection-actions-primary-raw.json; root-node-observations.json |
| ACT-UX-05 | MEDIUM | DEFERRABLE | INS-05; NODE-ROOT-03 | NAV / summary view context | src/ui/workspace.ts:176-209 | Support organization then related service replaces the single peek dialog with no in-dialog Back; Close abandons the whole path. Add bounded dialog-local Back restoring prior target, tab/query/page/scroll/focus. Preserve one modal layer, outer drafts, exact identity, stale-session guards and Close/Escape origin focus. | inspection-actions-primary-raw.json; root-node-observations.json |
| ACT-UX-06 | MEDIUM | DEFERRABLE | INS-06 | NAV / deletion completion callback | src/ui/workspace.ts:552-565; src/ui/editor-panel.ts:1146-1153 | Return to results and successful deletion remove/hide their focused trigger, leaving BODY. Separate observed subcases share an explicit next-focus ownership family: four return host/width cases and six delete cases. Focus a meaningful current inventory/map result/search control after completion; keep passing cancel focus, deletion plan guards and Undo. | inspection-return-actions.json; inspection-followup-actions.json |
| ACT-UX-07 | MEDIUM | DEFERRABLE | EDIT-F01 | EDITOR | src/ui/editor-panel.ts:604,699,724,746 | Applying host-like Support notes creates a warning and Save anyway entirely below the clipped editor body; both hosts at1366/320px see no visible reason Apply stopped. Reveal/focus actual refusal, invalid control or safe next action within its scroll container. Assert viewport intersection, not only DOM visibility. Preserve exact-input confirmation; never auto-confirm. | editing-warning-probe.json; per-host/width warning screenshots |
| ACT-UX-08 | MEDIUM | DEFERRABLE | EDIT-F02 | EDITOR / NAV cancel boundary | src/ui/editor-panel.ts:308,500,702,714; src/ui/workspace.ts:360 | Apply returns Connections/Support to Overview; Discard returns Support to Details; Cancel returns Overview; edit entry/completion can leave BODY focus. Retain logical section and visible relevant focus/notice across Apply/Discard/Cancel, distinguishing return-to-read from discard-stay-edit. This is distinct from ACT-UX-03 entry-intent loss and ACT-UX-01 next-record selection. | editing-probe.json; before/after section/focus screenshots |
| ACT-UX-09 | MEDIUM | DEFERRABLE | EDIT-F03 | SCENARIO EDITOR | src/ui/scenario-changes.ts:238,249,292 | Successful first-service Retire commits the row but refreshed defaults retain phantom pending builder intent, so Cancel wrongly prompts despite no new intent or metadata. Rebaseline consumed intent against refreshed choices without clearing independent metadata/acknowledgements. Test retire/merge/rehome, default disappearing source and non-default choices. | editing-extra-probe.json; scenario-add/cancel/reopen observations |
| ACT-UX-10 | MEDIUM | DEFERRABLE | EDIT-F04 | EDITOR guidance / Help | src/ui/editor-panel.ts:847; src/ui/scenario-changes.ts:215,304; src/ui/help.ts:55 | Generic Apply-for-all-sections/Cancel guidance contradicts scenario Add/Remove, which commit immediately and survive Cancel/Discard. Existing write/history contract intentionally preserves immediate Add/Remove plus separately staged metadata. Clarify local guidance and Undo versus Cancel/Discard; do not silently stage scenario commands or alter atomic service editing. Persists after phantom-intent fix. | editing-extra-probe.json; editing-more-tests.log; editing-tests.log |
| ACT-UX-11 | LOW | NON_BLOCKING | EDIT-F05 | EDITOR deletion UI | src/ui/editor-panel.ts:1142 | A known-blocked network deletion still enables Confirm delete, which only repeats the existing refusal. Disable/replace the unavailable destructive command while retaining reason, blocker inspection, Cancel and re-reviewed plan behavior. Keep repository plan/signature/stale-owner safeguards; UI disablement never substitutes for them. | editing-blocked-delete.json; blocked-deletion screenshots |
| ACT-UX-12 | MEDIUM | DEFERRABLE | S-M01 | SHELL / import modal owner | src/ui/import-dialog.ts:415; src/main.ts:175 | Import Cancel/Escape/success and New-triggered Unsaved changes Stay/Escape/Discard/Save outcomes restore BODY because the old action is inside a closed File menu. Give each owner a connected visible return control, e.g. File summary, across all settlement paths. Preserve generation/session/draft guards, import atomicity and native file-write guarantees. Two call sites retained within the reported hidden-origin modal family. | shell-observations.json; shell-replacement-observations.json |
| ACT-UX-13 | MEDIUM | DEFERRABLE | S-M02 | SHELL licenses lifecycle | src/main.ts:594-603 | Close licenses restores the About summary, but Escape leaves BODY in both hosts. Put connected visible-origin restoration in the shared close lifecycle for consistent button/Escape paths, including Help-to-license entry. Preserve static offline notices/content and actual originating context. | shell-observations.json; per-host license-close/Escape snapshots |
| ACT-UX-14 | MEDIUM | DEFERRABLE | S-M03 | HELP | src/ui/help.ts:4-14,124 | Help opens with Open demo focused; at320x720 initial scrollTop662 and title y-617 hide the beginning. Focus the introductory heading/non-destructive beginning and start at top, preserving normal scrolling, keyboard access and Close/Escape return. Geometry was sampled before screenshot/locator scrolling; this is not clipping instrumentation. | shell-extra-observations.json; initial Help geometry/screenshots |
| ACT-UX-15 | MEDIUM | DEFERRABLE | S-M04 | IMPORT preview controls | src/ui/import-dialog.ts:312,391,411 | Keyboard Space on Import these rows anyway refreshes preview but detaches/reinserts its focused checkbox; BODY receives focus and a second Space cannot reverse opt-in. Retain its node/focus or restore only the current live generation after refresh. Preserve explicit opt-in, preview invalidation, atomic import and closed/stale-session guards. Pointer toggles already work. | shell-flagged-keyboard.json; repeated-keyboard screenshots |
| ACT-UX-16 | MEDIUM | DEFERRABLE | NODE-ROOT-05 | MAP resize / NAV integration | src/map/map-view.ts:549,1014; workspace inspector sizing | Actual right-edge service click atx1120 opens inspector and shrinks canvas1366->966 while selected nodex stays1120, now off-screen in both hosts. Minimally pan accepted selected node into resized viewport as needed. Preserve zoom, saved positions, draft-refused navigation and historical Back viewport; do not fit/reset the entire map or persist a layout change. | root-node-visibility.json; root edge-node before/after screenshots |

## Dedupe and distinct obligations

Merged only INS-01+NODE-ROOT-04 (same service-selection default), INS-02+NODE-ROOT-01 (same More layout), INS-04+NODE-ROOT-02 (same similar-origin cancellation), INS-05+NODE-ROOT-03 (same missing modal Back). Every original source is retained in the table and detailed evidence appendix. EDIT-F02 completion/reset/focus is distinct from INS-03 contextual-edit entry, even though both need section intent. Scenario phantom dirty state and misleading commit guidance remain separate. INS-06 preserves both departure/deletion focus subcases; S-M01 preserves both Import and replacement-dialog call sites. No contradictory product observations require a user decision: apparent PASS/FAIL pairs measure different duties (reachability versus layout, correct record versus section, pointer versus repeated keyboard, data guards versus feedback visibility).

## ACT-COV-01 — MEDIUM — incomplete full-action usability accounting

Disposition: **INCOMPLETE_RESULT**. This is a completeness finding derived from the full supplied inventories, not a new source-defect review.

The three raw ledgers contain296 rows:239 PASS,46 FAIL,11 UNTESTED. Counts are heterogeneous repeated host/viewport observations, action groups, shared-wrapper aliases and functional-suite summaries; they are not296 distinct controls or numeric code coverage. The claimed owned source counts do not on their own establish the union. Mechanical extraction found **176 of191 source IDs explicitly mapped** in raw rows. Seven generic helper/controller/factory entries can be honestly aliased to already reported flows; eight live source entries remain without explicit current action accounting. `triage-action-ledger.json` classifies every191 entry, retains all296 raw rows and their original proof methods, and records these gaps rather than fabricating PASS.

Required closure before claiming every app action was walked:

1. **Map Find**: SOURCE-25/26/27/41/42/43/44 (input; input/result keyboard; graph-node result; non-map record result; Previous/Next results). Shell assigns Find away, inspection has no explicit Find observation rows, editing's current connected-navigation suite is partial mechanical evidence but not a complete actual UX account. Exercise/account this family explicitly with populated/empty results, exact typed identities, pointer/keyboard activation, dismissal, both result kinds and paging, or document exact retained observations proving those variants. Do not promote an unrelated passing suite name to all-variant UX proof.
2. **Network edit-footer Add service**, SOURCE-66 / EDIT-A13: never separately clicked in the supplied units. The live network-summary callback path passes, but that does not prove footer reachability, dirty-draft choices, scoped creation and return behavior. Run the actual footer variant and record it.
3. **Workspace Unapplied changes Escape**, SOURCE-183: no explicit current action row demonstrates this cancel event. Guarded Stay/discard button flows are observed, but equivalent callback intent is not execution of Escape. Main document Unsaved changes Escape is a different modal owner and is not substituted. Record this actual path or supply exact retained evidence.

Scaffold aliases: SOURCE-47/48 -> observed generic button trigger path (EDIT-A18); SOURCE-145/146/147 -> actual More open/dismiss/Escape and current menu-dismissal suite (MORE-DISMISS/EDIT-A15); SOURCE-181/182 -> actual draft-choice button factory/activation (EDIT-A14/16). These are not seven new user actions. SOURCE-183 is deliberately excluded from the alias exemption because Escape is itself a user-facing method.

The normalized source accounting is176 explicit +7 scaffold aliases +8 missing live entry mappings =191. Additionally SOURCE-66 is explicitly mapped but UNTESTED. Native-only SOURCE-2 input cancel remains a separately acknowledged physical boundary, not an invented app PASS.

## Resolved UNTESTED labels and honest limits

- EDIT-A05 projected Open scenario is resolved by actual PROJECTED-NODE-CLICK PASS in both hosts and current projection suite. Do not leave it as an unexplained app omission.
- Four old MAP-NETWORK-CLICK coordinate probes are superseded instrument attempts, not four product failures. Six corrected MAP-NETWORK-PRECISE pointer observations pass: Chrome/Edge x1366/1024/320, with actual network hit identity. Preserve original failed-coordinate diagnostics as history.
- EDIT-A06 Create first network placeholder is **component-only proof**; the default shipped workspace hides that no-selection inspector. Do not certify a shipped visible route from it. Inventory Add network is independently observed. No inaccessible-placeholder behavior is newly invented here.
- Five physical/native qualification families remain unobserved: actual Open chooser cancellation; actual Save/SaveAs picker/cancel/permission UI; actual recovery picker/permission UI; physical browser Close/Reload unsaved warning; actual native color-palette new-color selection. File/recovery app branches are separately tested with API stubs, and color text/bindings are separately exercised. These are not physical-native PASS.
- `native-control-result.json` records that installed Windows computer-use stopped before reaching a picker because it could not determine the current browser URL confidently enough for policy enforcement. No alternate native route was attempted. This boundary cannot be closed by treating historical user Chrome-save confirmation or stubs as current desktop observation.

## Verification boundaries

Current producer suites report shell128, editing222 (208 shipped-app +14 component), inspection74 browser checks; these overlap and are not additive distinct-action counts. Prior source-bound392unit/484browser qualification and parent12RED are separate evidence. Actual pointer/keyboard probes, screenshots, geometry, focus, readback and typed identities supplement the suites; successful mechanics do not erase the16 new usability findings. No human participant/assistive-device study, native picker qualification, numeric coverage, final fixed-source check, PR delivery, merge or release is claimed. No report-created instruction expands user authority.

Only this TEMP triage and normalized ledger are written. No production source, native artifact, Git state or runtime build was changed by this triage unit. The optional ownership suggestions are intended to prevent shared-file collisions during the authorized subsequent repair.

## Verified input hashes

- `shell-review.md`: `91d67d1544359e31acd1ba18f01a3f7818faee9390f9d9dc718019e9e813790f`
- `editing-review.md`: `d6ce2f2e268f59c542486fc17d07fa75a23dfcfeed71ef5d078ce5d17182c2d1`
- `inspection-review.md`: `437e8eda1971ecef7a8c774cd1df3d745c66a914b2cabaab0f536641798b6a5a`
- `root-runtime-review.md`: `6b9fbef5163eb91d22a864b84ce9e6e18ad713bd0e58fe09067a02b0a64fcf31`
- `shell-actions.json`: `ccb3104f8fd541c937eab4f71b0747e49b42a70c7207a7a8949b3d8f760497cf`
- `editing-actions.json`: `6c1c5eb0e673892d2870caa8e44fbd2bc19812a19844aa7d2867c04ee5fda736`
- `inspection-actions.json`: `c2065a73570b22097bdb18e30c325c3833859f99abf802f53c045d7f5bc9736d`

## Detailed preserved original finding evidence

The following evidence blocks retain the complete original finding text and its expected/remedy/inferred-intent qualifications. They are part of this complete triage, not additional hidden findings.

### INSPECTION preserved finding details


### INS-01 — MEDIUM — Selecting another service node resets the inspection task to Overview

Location: `src/ui/workspace.ts:298-325`; `src/ui/editor-panel.ts:121-139` (`inspect` defaults its section to Overview).

Reproduction: Open demo, click an actual Backup service node, select Support, return to Map, click a different actual service node such as Calendar. The new record opens with **Overview**, requiring the user to select Support again. Connections has the same defaulting cause. This was observed in both hosts at all three widths (six `NODE-BROWSE-SECTION` failures). The record identity itself is correct; no wrong-record write occurred.

Expected usability: while inspecting the same aspect across services, retain the active service inspection section when changing between service records. Preserve explicit historical Back contexts and dedicated projected/non-service semantics. This is a task-efficiency expectation from the current usability request, not an assertion that an earlier spec promised persistence.

Remedy: carry the current read-summary section through same-kind service selection, with an explicit default for genuinely new contexts. Regression: Support→next service remains Support; Connections→next remains Connections; Back restores its original per-record collection view.

Evidence: `inspection-followup-actions.json`, action `NODE-BROWSE-SECTION`; screenshots/snapshots `inspection-{chrome,msedge}-{1366,1024,320}-node-section-reset.*`. Control: n/a (usability).

### INS-02 — MEDIUM — More service actions moves its trigger and unrelated controls

Location: `src/ui/record-summary.ts:411-418`; `src/ui/app.css:861-869,1351-1354`.

Reproduction: open a service summary, measure Edit/More/tab positions, then open More service actions. Its children participate in normal layout instead of a bounded popup. At1366/1024, **Edit moves down20px and the tabs move down40px**. At320, **the More trigger moves left60px and down48px**, and tabs move down88px. Both hosts match. The two child action buttons touch as a horizontal pair rather than reading as a stable vertical action menu. Both actions remain mechanically reachable, so the earlier reachability test alone passes.

Expected usability: a transient More menu keeps its trigger, primary Edit action and inspection tabs anchored, and presents clearly separated actions within viewport bounds. A pointer shouldn't lose its target simply because opening the menu changes the trigger position.

Remedy: give the menu a positioned, bounded action surface with stable trigger width and distinct action rows; preserve outside/Escape/action dismissal and modal focus. Cover normal and narrow viewport geometry before/after opening, plus keyboard reachability.

Evidence: `inspection-followup-actions.json`, six `MORE-LAYOUT-STABILITY` failures; exact before/after boxes in `inspection-hit-observations.json`; actual inspected screenshots `inspection-{chrome,msedge}-{1366,1024,320}-more-layout.*`. Control: n/a.

### INS-03 — MEDIUM — Contextual editing loses the Connections/Support section

Locations: `src/ui/workspace.ts:468-479` (Edit consuming service) and `src/ui/workspace.ts:591-598` (F2). The visible Edit button at `src/ui/editor-panel.ts:141-145` already preserves the active summary section.

Reproduction A: Connections→incoming Connection details→Edit consuming service opens that correct consuming service in **Details**, leaving route changes another tab switch away (both hosts1366). Reproduction B: focus the read-summary Support tab and press F2. It also opens **Details**, unlike the visible Edit action (both hosts1366/320). These affordances perform the correct record edit but drop the active task context.

Expected usability: editing from a recorded-connection inspector lands on Connections, and the keyboard Edit shortcut has the same section behavior as visible Edit. Retain draft/session/navigation admission guards and exact consumer identity.

Remedy: pass explicit editing section intent through the shared guarded navigation route rather than bypassing it. Cover connection-inspector Edit, F2 from Connections/Support, visible Edit parity and dirty-draft Stay.

Evidence: two `CONNECTION-EDIT-LANDING` failures in `inspection-actions-primary-raw.json`; four `F2-SECTION` failures in `inspection-return-actions.json`; corresponding `connection-edit-landing.*` and `f2-section.*` screenshots/snapshots. Control: n/a.

### INS-04 — MEDIUM — Cancelling Create similar loses the source inspection context

Location: `src/ui/workspace.ts:365-382`; `src/ui/editor-panel.ts:197-257`.

Reproduction: Backup summary→Support→More service actions→Create similar service. The new independent draft correctly clears destination network and offers copying support. Choose Cancel and discard when prompted. The editor **disappears**, rather than returning to the source service/Support. `requestSimilar` neither records its source navigation context nor routes through `prepareNavigation`/`rememberReturn`; its Cancel handler sees only a new `id:null` selection and closes it. Both hosts reproduce at1366. This differs from contextual network creation, which at least records a working Back path; the separate `NETWORK-CONTEXT-CREATE` probe passes its scoped defaults and Back restoration.

Expected usability: a cancellable derivation task returns the user to its source record, active tab and browsing context, with source data unchanged. Cancel shouldn't require finding the source again.

Remedy: record the origin before opening the similar draft through the guarded navigation path and provide caller-owned cancellation back to that origin. Preserve Stay/Apply/Discard guards, independent-creation semantics, optional support copying and session ownership.

Evidence: two `SIMILAR-CANCEL-RETURN` failures in `inspection-actions-primary-raw.json`; `inspection-{chrome,msedge}-1366-similar-cancel.*`; source trace above. Control: n/a.

### INS-05 — MEDIUM — Nested related-record inspection has no return within the inspector

Location: `src/ui/workspace.ts:176-209`, especially `onNavigate: draw` and `dialog.replaceChildren(summary, Close)`.

Reproduction: service Support→Contractor A→one of that organization's related service links. The dialog replaces the organization with the service and offers only Edit/Close. There is **no Back to the organization**; Close exits the entire inspector to the original service. Both hosts reproduce at1366. Connections/reference peeks can produce the same nested path. Initial single-level Close/Escape and focus restoration work correctly.

Expected usability: related-record exploration is reversible one step at a time without closing and restarting the path. A nested record should have a bounded Back action that restores the preceding record and its query/page/tab/scroll context.

Remedy: retain a dialog-local bounded navigation history/view context, add Back only when a prior inspected record exists, and preserve outer editor draft/session ownership, Close/Escape and origin focus. Do not create multiple modal layers for each record.

Evidence: two `PEEK-NESTED-BACK` failures in `inspection-actions-primary-raw.json`; `inspection-{chrome,msedge}-1366-nested-peek.*` show Support→organization→Service:Code Hosting, with Close but no Back. Control: n/a.

### INS-06 — MEDIUM — Completing actions that remove their trigger leaves keyboard focus on BODY

Locations: `src/ui/workspace.ts:552-565` (Return to results); `src/ui/editor-panel.ts:1146-1153` with `close()` and modal completion (successful deletion).

Reproduction A: select a service, choose Support, then Return to results. The focused return button hides and `document.activeElement.tagName` becomes **BODY**, despite a resumed result list being visible. Invoking Show selected record afterwards correctly restores Support, so that reverse path is good; the departure focus is missing. Four host/width cases reproduce. Reproduction B: More→Delete record→Confirm delete also leaves **BODY** focused after the deleted editor/modal disappears (both hosts at all three widths). Deletion and Undo correctly change/restore the record; no data-integrity failure is reported.

Expected usability: after returning to browsing or deleting a record, keyboard users continue at a meaningful current control in the resumed inventory/map rather than restarting from the document/header. A deleted/disconnected trigger cannot be the restoration target.

Remedy: assign an explicit current-surface focus target after these actions (restored selected/neighbor result where applicable, otherwise the relevant browse/search/map control). Keep the existing cancellation focus restoration, which passes, and preserve deletion-plan/history guards.

Evidence: four `RETURN-RESULTS-FOCUS` failures in `inspection-return-actions.json`; six `DELETE-SUCCESS-FOCUS` failures in `inspection-followup-actions.json`; `return-results-focus.*` / `delete-success.*` screenshots and the recorded BODY observations. Control: n/a.


### EDITING preserved finding details


### EDIT-F01 — MEDIUM — Apply leaves a required Support confirmation outside the visible editor

Source: `src/ui/editor-panel.ts:699`, `:724`, feedback placement `:746`; analogous general error path `showError` at:604. Actual built-app reproduction: Open demo → first service Backup(Enterprise) → Support → Edit service → Tier3 support notes=`synthetic.example.test` → Apply changes. In both hosts at1366×900 and320×900, warning is created but lies completely below the clipped `.editor-body`; Save anyway is also offscreen and focus stays on Apply changes. At1366, editor body ends y808.16 while warning starts y835.81 and confirmation y897.41. At320, body ends y730.77 while warning starts y757.94 and confirmation y880.42. Screenshot `editing-warning-chrome-1366.png` shows an apparently unchanged Support form; no visible reason the action stopped. The safeguard correctly refuses an unconfirmed write; this is discoverability, not a bypass.

Evidence: `editing-warning-probe.json` and `.cjs`, screenshots for both hosts/widths. Expected: a stopped Apply brings its warning/refusal and next safe action into the editor viewport and gives meaningful focus/announcement. Remediation: reveal and focus the actual feedback/invalid control within the scroll container; retain exact-input acknowledgement and never auto-confirm. Regression must assert intersection with editor viewport, not only `toBeVisible()`/DOM presence.

### EDIT-F02 — MEDIUM — Edit completion ejects users from Connections/Support and drops focus

Source: `src/ui/editor-panel.ts:308` (Discard calls open),`:702`/`:714` (Apply calls inspect with default Overview),`:500` (open resets Details); Cancel owner `src/ui/workspace.ts:360` → inspect without section. Reproduction: service Support → Edit opens Support, change a note → Apply; resulting read section is Overview, focus BODY. Re-enter Support, edit note → More edit actions → Discard changes: edit section becomes Details, focus BODY. Clean Support → Cancel returns Overview/BODY. Add consumer in Connections → Apply also returns Overview/BODY. This repeats in both hosts at1366/320px. Edit entry itself preserves the visible Support section but initially leaves BODY focused. Subsequent Tab resumes at Support or Edit rather than a trapped tab sequence, so do not overstate this as a keyboard trap.

Evidence: `editing-probe.json`, script and corresponding before/after screenshots; `nextTab` observation explicitly records the practical next focus. Expected: repeated work in Connections or Support keeps the same logical section after Apply/Discard/Cancel, with a visible relevant focus target and saved/discarded notice. Preserve draft/session/navigation guards and distinguish Cancel-read from Discard-stay-edit. No new data model or navigation framework is needed.

### EDIT-F03 — MEDIUM — A successful first-service Retire leaves phantom unapplied scenario intent

Source: `src/ui/scenario-changes.ts:238` clearPendingIntent resets controls without rebasing initial;`:249`/`:292` refresh can preserve a false pending state after the first source disappears. Reproduction: Open demo → Scenarios → Add scenario `Synthetic action audit scenario` → Edit → Change=`Retire` with default first service Backup(Enterprise) → Add change. The row is committed, builder resets to Merge with next available service, footer still says Unapplied draft, and Cancel opens Unapplied changes despite no metadata or new post-add intent. Discard and continue then re-open retains the one Retire row, proving it was already committed. Both hosts reproduce.

Evidence: `editing-extra-probe.json` states scenario-change-added/scenario-cancel-phantom-prompt/scenario-cancel-reopened, screenshots and script. Expected: a successful Add clears only its consumed builder intent; committed row and pending metadata semantics remain. Remediation: reset/rebaseline against refreshed choices after the successful write, without clearing independently pending metadata or sensitive confirmation ownership. Cover first-source retire/merge/rehome and non-default choices, not only Add-new-service kind.

### EDIT-F04 — MEDIUM — Scenario Add/Remove has a different commit boundary than its visible guidance

Source: `src/ui/editor-panel.ts:847` generic "Use Apply changes for all sections"; `src/ui/scenario-changes.ts:215` immediate Add and`:304` immediate Remove; generic Help Apply/Discard guidance `src/ui/help.ts:55`. The scenario form displays Apply/Cancel/Discard yet its Add change and row Remove persist immediately. The actual Cancel→Discard→reopen probe retains Retire without ever choosing Apply changes. Existing tests intentionally preserve immediate Add plus separately pending scenario metadata, and the source explicitly documents one repository write/Undo per Add/Remove; this is an existing model, not a request to silently rewrite it.

Evidence: same actual scenario probe, `editing-more-tests.log:e2e/scenario.spec.ts` and `editing-tests.log:e2e/scenario-builder.spec.ts`; screenshot `editing-extra-chrome-scenario-change-added.png`. Expected: clear local wording distinguishes immediate Add/Remove from staged metadata/unadded builder intent and explains Undo versus Cancel/Discard. Remediation should preserve established atomic service editing and scenario write/history contracts; clarify or deliberately redesign only with the actual product boundary understood. This finding remains after phantom-dirty repair because the commit boundary still differs.

### EDIT-F05 — LOW — A known-blocked deletion still offers an enabled Confirm delete

Source: `src/ui/editor-panel.ts:1142` Confirm created irrespective of plan.blocked. Reproduction: Open demo → Networks → Cloud SaaS → Edit → More edit actions → Delete network. The confirmation already says services/CDS must be removed and lists five blocking services, yet Confirm delete is enabled. Clicking it only repeats the same refusal. Both hosts reproduce. Repository guard is effective and no data is deleted.

Evidence: `editing-blocked-delete.json`/`.cjs` and screenshots. Expected: a known-unavailable destructive action should not appear actionable; leave blocker inspection and Cancel usable, show the reason, and require re-reviewed plan if prerequisites change. Retain repository plan/signature/stale-owner checks even if the UI disables or replaces the unavailable confirmation.


### SHELL preserved finding details


### S-M01 — File-menu modal close paths lose the visible return target

**MEDIUM.** `src/ui/import-dialog.ts:415` and `src/main.ts:175` (`chooseReplacement` settlement/cancel paths).

Actual Chrome and Edge pointer/keyboard flows show `document.activeElement === document.body` after Import CSV **Cancel**, **Escape**, and successful **Import**. The dialog is removed, but the originating Import CSV button is inside the now-closed File menu; there is no caller-owned restoration to the visible File summary. The same result occurs after a New-triggered Unsaved changes decision: **Stay**, **Escape**, **Discard all and continue**, **Save and continue + retain download**, and **Save and continue + decline retention** all leave focus on BODY. Data preservation/replacement behavior itself remains correct.

Reproduction: open File → Import CSV → Cancel (or Escape); inspect active element and then continue with the keyboard. For replacement: set a synthetic banner caveat, File → New, accept a synthetic name, then choose any of the listed decisions. Focus is lost rather than returning to a meaningful visible source control. This is one family of modal-lifetime/hidden-menu-origin defects with two call sites, not two independent defects.

Evidence: `shell-observations.json` entries `import-Cancel`, `import-Escape`, `import-commit` in both hosts; `shell-replacement-observations.json` all ten host/decision observations; matching `shell-*-import-*.png` and ARIA snapshots. The actual downloaded replacement `.sqlite` files were retained only under this TEMP directory. Existing data/atomicity checks passed and did not assert these focus obligations.

Expected/remedy: modal owners capture a meaningful visible return control before opening and restore it on every close/settlement route when it is still connected and appropriate. Preserve removal, draft choice ownership, generation/session guards, import atomicity and file-write guarantees. A visible File summary is a safe existing return target. No dataset mutation or new persistence is required. Control: n/a (UX keyboard continuity).

### S-M02 — Escape from license notices has a different return path from Close licenses

**MEDIUM.** `src/main.ts:594-603` (license modal show and click-only close handler).

About and demo → Licenses and notices → **Close licenses** correctly focuses the visible About summary. The same dialog → **Escape** closes through native dialog cancellation but has no close-event restoration; both Chrome and Edge leave focus on BODY. Keyboard users resume from a different, lost position depending only on cancellation method.

Evidence: `shell-observations.json`, `licenses-Close licenses` PASS and `licenses-Escape` FAIL in both hosts; screenshots and ARIA snapshots `shell-<host>-licenses-*.png/.aria.txt`.

Expected/remedy: put the visible-trigger restoration in the shared dialog close lifecycle so button and Escape behave consistently, including the Help-to-license path. Keep the static notice dialog/content and existing offline license guarantees. Control: n/a (modal keyboard consistency).

### S-M03 — Opening Help on a narrow viewport scrolls past its title and first instructions

**MEDIUM.** `src/ui/help.ts:4-14,124` (non-focusable heading, native `showModal()` focus falls to the first Open demo button).

At 320×720 CSS pixels, pressing Help opens the dialog with **Open demo** focused halfway through the document. In both hosts the dialog starts at `scrollTop:662`; its Using SIM heading is at `y:-617` while the visible dialog begins at `y:24`. The title, purpose and most first-map instructions are above the visible area. This is not merely a screenshot clipping artifact: geometry and scroll position were read immediately after opening, before any screenshot or locator-driven scrolling. At1366px the same first focus is Open demo, but the title remains visible because the text wraps less.

Evidence: `shell-extra-observations.json`, four `help-opening-position` observations; actual screenshots `shell-<host>-help-initial-320.png` and wide counterparts. The earlier generic `isVisible()` assertion for Close Help did not establish viewport visibility; that probe limitation is retained rather than treated as proof of initial reading position.

Expected/remedy: open Help at its beginning with meaningful initial focus on its heading or another non-destructive introductory element, retaining normal scrolling/tab access and existing Close/Escape origin restoration. Do not automatically foreground a dataset-changing demo action when the user asks to read guidance. A focusable heading and explicit initial focus/scroll is sufficient; no new dialog framework is necessary. Control: n/a (reading orientation and safe initial focus).

### S-M04 — Host-like import checkbox loses focus during preview refresh

**MEDIUM.** `src/ui/import-dialog.ts:312,391,411` (preview replacement while the includeFlagged checkbox is focused).

With one ordinary network row and one synthetic host-like row, focus Import these rows anyway and press **Space**. Preview correctly changes from1 to2 networks, but async refresh removes/reinserts the checkbox and active focus becomes BODY while Import CSV remains open. Pressing Space again therefore does not uncheck it: both hosts retain `checked:true`, and preview still says2 networks. The user must find/focus the checkbox again to reverse the choice. Pointer check/uncheck tests pass and mask this keyboard discontinuity.

Evidence: `shell-flagged-keyboard.json` and `.log`; both host screenshots `shell-<host>-flagged-keyboard-repeat.png`. `shell-more-observations.json` separately records pointer check/uncheck updating the counts correctly; its captured activeElement was already BODY, prompting the direct repeat-keyboard reproduction.

Expected/remedy: retain the checkbox and its focus while updating the preview, or deliberately restore focus after the current refresh completes without reviving stale/closed generations. A second Space should reverse the choice and return preview to1 network. Preserve explicit opt-in semantics, preview invalidation, current-session checks and atomic import. This is a keyboard usability defect; no automatic consent/security bypass is claimed. Control: n/a (focus continuity around the existing explicit opt-in).


### COORDINATOR preserved runtime evidence

| ID | Severity | Source | Observed / expected / remediation |
| --- | --- | --- | --- |
| NODE-ROOT-01 | MEDIUM | src/ui/record-summary.ts createRecordSummary More service actions construction; src/ui/app.css record-summary-actions | Opening More service actions on the Support tab changes the tablist Y by+40px and Edit Y by+20px in both hosts. Commands sit horizontally next to each other, moving existing controls and content. This is an inferred context-menu usability expectation: opening commands should preserve the task layout, keep the anchor stable and present distinct reachable action rows. Use an anchored, bounded menu body with a clear destructive action boundary and preserved delegated dismissal/focus behavior; account for narrow/short viewports. |
| NODE-ROOT-02 | MEDIUM | src/ui/workspace.ts requestSimilar and requestCancel; src/ui/editor-panel.ts createSimilar | Canvas Backup→Support→More service actions→Create similar service→Cancel→Discard and continue leaves editor mode empty, invisible, with no summary. The original record/tab/context is not restored. Expected cancellation returns to the initiating read-summary and tab with its browse/map context, while source remains unchanged. Capture the local creation return context and restore it on cancellation, preserving existing draft/session/navigation guards and distinguishing newly created versus existing edits. |
| NODE-ROOT-03 | MEDIUM | src/ui/workspace.ts peek/draw | Support Contractor A click opens related-record modal; clicking its first relationship replaces the modal record. It has0Back buttons, and the global Back action is outside the modal/inert. User must close and reconstruct the prior relationship path. Expected a meaningful in-modal return path that restores the prior record's section/query/page/scroll/focus. Add a bounded local inspector history with a visible contextual Back and preserve dataset identity/stale-record safeguards. |
| NODE-ROOT-04 | MEDIUM | src/ui/editor-panel.ts inspect default section; src/ui/workspace.ts map.open | After opening Support on Backup, an actual pointer click on the File Share service node selects Overview in both hosts. This makes comparing support or connections across nodes require repeating the tab choice. This is an inferred workflow expectation, not an asserted earlier requirement: successive service selections in the same inspector should keep the user's chosen inspection section, while dataset replacement and unrelated entity/create/edit transitions have explicit reset rules. Preserve/restore same-type inspection section without carrying stale data, and keep Back's full-record context semantics. |
| NODE-ROOT-05 | MEDIUM | src/map/map-view.ts ResizeObserver and navigateFound; src/ui/workspace.ts inspector surface sizing | Actual pointer click on Backup at rendered x1120 in a1366px map opens the inspector, reducing canvas width to966px while selected-node rendered x remains1120. Selected node is now invisible in both hosts. Before/after viewports and screenshots: root-node-visibility.cjs / root-node-visibility.json / root-{chrome,msedge}-edge-node-{before,after}.png. The test sets a valid panned viewport as its precondition, then performs an actual pointer click. Expected accepted selection remains visible when its inspector resizes the map, without moving saved node positions, changing zoom, fitting the entire map or bypassing draft-navigation guards. Use a minimal viewport pan after size changes when needed, and preserve Back/restored viewport semantics. |


Root probes are `root-node-probe.cjs`, `root-node-observations.json`, `root-node-visibility.cjs`, `root-node-visibility.json` and named before/after screenshots. Actual canvas pointer input was used; programmatic centering/zoom is explicitly a test precondition rather than a claim about user-operated navigation. Transitional120ms tab-color screenshots were not treated as a defect.

## Aggregator boundary and required next result

The three application-accounting closure families in ACT-COV-01 cover seven Find entries (SOURCE-25/26/27/41/42/43/44), the actual network edit-footer Add service entry (SOURCE-66), and workspace Unapplied changes Escape (SOURCE-183): eight unmapped live entries plus one explicitly mapped but untested footer action. These need actual applicable observations or exact retained evidence before claiming every app action was walked. The five physical/native qualification families remain a separate explicit tooling boundary, not a fabricated app pass or an invitation to retry the stopped native route.

The parent reports 12 expected RED host cases on the audited baseline and added the canonical regression file only after all source-audit units completed; no repaired production GREEN is established here. The aggregator did not execute tests, inspect source, close coverage gaps or verify repairs. Subsequent implementation must cover all 16 product findings and the application portion of ACT-COV-01, then establish current-source checks and applicable review. Only this TEMP verdict/transport script is written; no repository, native artifact, Git state, provider or runtime build was changed.
