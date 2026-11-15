# SIM release-readiness review

**Perspective:** a solutions engineer entering an unfamiliar enterprise, recording evidence, identifying unknowns, and producing a defensible picture.

**Verdict: hold final end-user sign-off.** The recent redesign is a substantial improvement, but unfinished connection choices, saved-versus-pending inspection, invalid focus and the release-download mismatch remain. These are not requests for another visual redesign.

Reviewed main: `55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121`. Date: November 15, 2026. No repository changes were made.

## Verification before conclusions

This review read the current interaction owners, data model, user guidance, selected tests and release metadata. It executed three complete current source modules (dom, reference-picker, focus), verified against their Git blob hashes, plus copied current Apply/dirty-check/connection-lookup fragments with controlled adapters. It did **not** run the complete current offline application, its SQL engine or native file dialogs. Component screenshots do not show the production stylesheet.

GitHub CI run 43742863179 is successful. Its head tree matches reviewed main. The PR reports 392 unit and 612 browser tests, which this review did not independently recount. Green automation is valid evidence for its assertions, not proof that all first-user task paths are safe.

The published v0.1.0 download still points to commit `6c489bf1b6b0dd3f70470174625e404b1d21f5bb`, published November 12, before the reviewed usability changes. Main and the downloadable application must not be treated as the same acceptance subject.

A literal `fixLater` was not found in the source sections reviewed. This is **not a repository-wide absence claim**: code search returned no result even for a function known to exist, so negative search results were not trusted. The concrete misleading strings below are source-established.

## What improved and must not be regressed

Read-first record summaries, separate Inventory/Map surfaces, compact searchable pickers, in-context shared creation, independent Create similar service, sectioned aggregate editing, an editor footer outside the scrolling body, paginated relationship collections, contextual map actions, import receipts, explicit map scope and safe-copy/recovery concepts are present. Do not rebuild those as if absent. The next work is finishing their cross-boundary behavior and the user-facing language.

## Severity

S1 means resolve before a normal end-user release or before directing users to the release channel. S2 means a concrete user-readiness defect or important operational gap; its urgency depends on the intended audience. G entries are product capability gaps, not claims of broken code. V entries explicitly require further integrated verification.

## Finding register

| ID | Priority | Finding | Evidence |
|---|---|---|---|
| R01 | S1 | Apply accepts an unfinished dependency or consumer selection without including it | Executed source branch with controlled adapters; complete editor path traced |
| R02 | S1 | An open route editor is outside draft detection and Apply | Source trace plus Apply-boundary probe |
| R03 | S1 | A pending connection can open saved details or do nothing | Executed lookup fragment and current editor/workspace wiring |
| R04 | S1 | Removing a focus subject hides the remaining map | Executed complete focus module; refresh/view lifecycle source traced |
| R05 | S1 | The published download is not the reviewed merged application | Live GitHub release and tag metadata |
| R06 | S2 | An enterprise started in Untitled dataset has no rename path | Current shell, form and capture source |
| R07 | S2 | Unassigned provider is presented as No provider | Current inventory source |
| R08 | S2 | Shared creation copy says service while editing an organization | Current referenceControls path |
| R09 | S2 | Picker promises creation where creation is unavailable | Executed complete picker component in Chromium |
| R10 | S2 | Projected inspection is a developer-oriented second-class summary | Current projected inspector and connection inspector source |
| R11 | S2 | A scenario-change link does not identify a scenario change | Current diagnostic target construction and navigation |
| R12 | S2 | Scenario authoring still uses unbounded, preselected control lists | Current scenario builder source |
| R13 | S2 | Startup failure has no user-facing boundary | Source failure-path review; fault injection still required |
| R14 | S2 | The normal Save shortcut is not wired to dataset saving | Source-confirmed missing handler; native browser behavior not retested |
| R15 | S2 | Legacy issues are truncated without a persistent repair surface | Current dataset-open path |
| R16 | S2 | A successful-change error suggests reopening without first protecting work | Current shell failure text |
| R17 | S2 | Navigation records the outer editor scroll, not the editing body | CSS and context capture source; integrated journey still required |
| R18 | S2 | Help and entry documentation retain misleading or implementation-level language | Current help/README and rendered headings |
| R19 | S2 | A zero-result filter has no dedicated map empty state | Current map visibility and empty-hint source |
| R20 | S2 | About exposes the database engine version but not the application build | Current shell and release metadata |

## R01 · Apply accepts an unfinished dependency or consumer selection without including it

**S1 · Executed source branch with controlled adapters; complete editor path traced**

**User journey.** Edit an existing service. Choose a dependency or consuming organization. Before Add dependency/Add consumer, choose Apply changes, Save file, or Apply and continue.

**Observed.** The chooser sets relationIntent.touched, so hasPendingDraft reports pending work. The service-save branch reads only serviceDraft arrays. The probe recorded applied=true, an empty dependency/consumer payload, and the completion call with No changes to apply. Production inspection resets the composer. A staged-row positive control includes the dependency correctly.

**Why it matters.** An engineer can believe an interview detail was retained when the successful operation omitted it. This is loss of unfinished user work, not evidence that previously committed rows are deleted.

**Required outcome.** Either include the fully specified composer in the single Apply, or refuse Apply with a focused Finish adding or cancel this connection action. Never report overall completion and discard it. Apply, Save file and navigation must share that decision.

**Acceptance.** Exercise consumer and dependency selections separately, with valid/invalid route, name edit, Save file, Apply, Apply-and-continue and Capture. Reopen the saved dataset to verify content. Use Add first as the positive control.

**Source:** [src/ui/editor-panel.ts:264-307](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L264-L307); [src/ui/editor-panel.ts:647-754](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L647-L754); [src/ui/editor-panel.ts:1366-1540](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L1366-L1540); [src/ui/workspace.ts:304-340](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/workspace.ts#L304-L340).

**Executed evidence:** [evidence/draft-probe.json](evidence/draft-probe.json)

## R02 · An open route editor is outside draft detection and Apply

**S1 · Source trace plus Apply-boundary probe**

**User journey.** For an existing dependency, open Actions > Edit route, select a different CDS, and use the parent Apply or navigate before Use route.

**Observed.** The temporary route select has no draft change collector. Only Use route changes dep.viaCdsId. In the boundary probe the visible candidate was route 5, hasPendingDraft was false, and Apply still submitted route 4. No full browser route interaction is claimed by this probe.

**Why it matters.** The editor can say no unapplied changes while a visible route choice differs from the stored route. Navigation can omit a loss decision.

**Required outcome.** Track the open route task as pending work, or integrate it into the service draft. Save/Apply must resolve it; cancellation must intentionally restore it.

**Acceptance.** Change the route without Use route, then test Apply, Save, Back, Cancel and another service. No input disappears through a successful completion.

**Source:** [src/ui/editor-panel.ts:1410-1460](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L1410-L1460); [src/ui/editor-panel.ts:264-307](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L264-L307); [src/ui/editor-panel.ts:647-754](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L647-L754).

**Executed evidence:** [evidence/draft-probe.json](evidence/draft-probe.json)

## R03 · A pending connection can open saved details or do nothing

**S1 · Executed lookup fragment and current editor/workspace wiring**

**User journey.** Add a dependency to an existing service but do not Apply. Inspect connection from the pending row. Separately stage a route change and inspect it.

**Observed.** Rows come from serviceDraft, but requestDependency passes repo.snapshot(). The new pending relationship has no saved row, so the inspector returns without UI. A changed route produces details for its old saved route.

**Why it matters.** The user cannot tell whether the visible connection or the inspector is authoritative.

**Required outcome.** Inspect the same state as the invoking row and label it Pending, or make the saved-state scope explicit and do not offer an inert action for a not-yet-applied row.

**Acceptance.** Pending addition, pending route edit, pending removal, applied row, and projected row each show accurate state; no action silently returns.

**Source:** [src/ui/editor-panel.ts:1396-1486](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L1396-L1486); [src/ui/workspace.ts:460-520](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/workspace.ts#L460-L520); [src/ui/workspace.ts:521-595](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/workspace.ts#L521-L595).

**Executed evidence:** [evidence/draft-probe.json](evidence/draft-probe.json)

## R04 · Removing a focus subject hides the remaining map

**S1 · Executed complete focus module; refresh/view lifecycle source traced**

**User journey.** Focus Depends on a service, then delete that service through Inventory; or switch to a To-Be view that retires it. Return to Map.

**Observed.** focusGraph returns an empty visible set for a missing subject. The current refresh and switchView paths do not clear or revalidate focus. applyView therefore filters all nodes. The pure-module probe retained four graph nodes but exposed zero. The UI supplies Focus target unavailable, but that message tells the user to select a current record while the map itself is empty.

**Why it matters.** A populated enterprise appears to disappear after a normal change or scenario switch. Capture remains enabled while graph nodes exist.

**Required outcome.** When a focus target is no longer in the displayed graph, explicitly end that focus or restore its prior valid scope and explain why. Do not silently capture a misleading blank map.

**Acceptance.** Delete, retire, merge away, switch projection and Undo a focused subject. Remaining records stay reachable. Export reflects a valid scope.

**Source:** [src/map/focus.ts:26-36](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/focus.ts#L26-L36); [src/map/map-view.ts:665-705](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L665-L705); [src/map/map-view.ts:1175-1280](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L1175-L1280).

**Executed evidence:** [evidence/focus-probe.json](evidence/focus-probe.json)

## R05 · The published download is not the reviewed merged application

**S1 · Live GitHub release and tag metadata**

**User journey.** A new user downloads the published SIM HTML from Releases.

**Observed.** The only listed release is v0.1.0, published November 12, 2026. Its annotated tag resolves to 6c489bf1b6b0dd3f70470174625e404b1d21f5bb, not the reviewed main. The HTML asset was last updated November 12. New merges do not update this artifact.

**Why it matters.** A user following the release channel receives the pre-coherence application, regardless of current-main fixes.

**Required outcome.** After fixes and acceptance, publish a versioned artifact from the approved commit, verify the downloaded bytes, and point user instructions at that artifact. Do not overwrite or relabel the old binary as tested current code.

**Acceptance.** The exact downloaded artifact has the approved build identity and checksum. Run the user acceptance journeys against those bytes, not a dev server.

**Source:** [GitHub release metadata](https://github.com/SUaDtL/SIM/releases/tag/v0.1.0); [Git tag object](https://api.github.com/repos/SUaDtL/SIM/git/tags/8cc5cc9a52cf8e2fd1d55bc9ea1108eb126c1b6d).

## R06 · An enterprise started in Untitled dataset has no rename path

**S2 · Current shell, form and capture source**

**User journey.** Start entering a real enterprise in the initial document, save to a meaningful filename, then capture a briefing image.

**Observed.** Boot creates Untitled dataset. New asks for a name, but the current shell offers no rename action. Save As changes the filename, not the embedded dataset name. Capture takes repo.datasetName().

**Why it matters.** The engineer can end up with a serious assessment and exported figures titled Untitled dataset, with no ordinary rename operation.

**Required outcome.** Offer document name editing in document information without recreating inventory; keep filename and document title distinct and clear.

**Acceptance.** Rename a populated document, Save As, reopen, and export. References, history and classification remain intact.

**Source:** [src/main.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/main.ts); [src/map/map-view.ts:843-925](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L843-L925).

## R07 · Unassigned provider is presented as No provider

**S2 · Current inventory source**

**User journey.** Enter a discovered service whose responsible organization is not yet known.

**Observed.** The inventory substitutes No provider when providerOrgId is null. Elsewhere the summary uses Not assigned.

**Why it matters.** A data omission looks like a confirmed enterprise fact. This matters when the map is used to identify ownership gaps.

**Required outcome.** Use Provider not recorded or Not assigned consistently. A future Confirmed none state must require an explicit assessment rather than inferring from null.

**Acceptance.** A service with no provider is described as unrecorded in Inventory, summary, search and detached outputs.

**Source:** [src/ui/list-panel.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/list-panel.ts); [src/ui/record-summary.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/record-summary.ts).

## R08 · Shared creation copy says service while editing an organization

**S2 · Current referenceControls path**

**User journey.** Edit an organization and create its missing parent organization from Part of.

**Observed.** The same child creator is attached to organization.parentId, but its hint says cancel the service / Your service is still a draft, and its success says Service changes are still pending.

**Why it matters.** The user is told about a different task and cannot confidently understand which record has been saved.

**Required outcome.** Derive the parent noun and identity from the invoking task; use neutral parent wording where necessary.

**Acceptance.** Create references from a service and a parent organization. Every message names the actual parent and the independently created child.

**Source:** [src/ui/editor-panel.ts:947-1050](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L947-L1050).

## R09 · Picker promises creation where creation is unavailable

**S2 · Executed complete picker component in Chromium**

**User journey.** Open an empty or no-match source-service/dependency picker that has no create callback.

**Observed.** The rendered message is No matching records. Try another name or create one. There are zero visible creation buttons. Escape and exact duplicate-name keyboard selection passed as positive controls.

**Why it matters.** The apparent next action is impossible. This is a real unfinished-state message, not legitimate missing inventory.

**Required outcome.** Condition the empty state on supported actions. Where inline service creation is intentionally out of scope, offer a context-preserving route to add one or simply describe the limitation.

**Acceptance.** Empty and no-match states for every picker offer only actions that actually exist.

**Source:** [src/ui/reference-picker.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/reference-picker.ts); [src/ui/editor-panel.ts:876-965](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L876-L965).

**Executed evidence:** [evidence/picker-probe.json](evidence/picker-probe.json), [evidence/picker-empty-component.png](evidence/picker-empty-component.png)

## R10 · Projected inspection is a developer-oriented second-class summary

**S2 · Current projected inspector and connection inspector source**

**User journey.** Inspect the same service in As-Is and To-Be/Compare while explaining the proposed enterprise.

**Observed.** The baseline has a structured summary. Projected inspection primarily shows network, marking, counts, internal comparison-status values and projection-effect paragraphs. Projected connection origins can be As-Is service #ID or change #ID. Descriptions, provider and support context are not presented at comparable depth.

**Why it matters.** The proposed design is harder to explain and validate than the baseline. IDs and counts replace business-readable identities.

**Required outcome.** Present equivalent read-only information with qualified names, explicit before/after changes and exact originating-change links. Keep storage IDs in optional diagnostics.

**Acceptance.** For moved, retired, merged and planned services, a reviewer can identify provider, purpose, support and each changed relationship without entering edit mode or interpreting numeric IDs.

**Source:** [src/ui/editor-panel.ts:335-466](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L335-L466); [src/ui/workspace.ts:500-583](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/workspace.ts#L500-L583); [src/ui/record-summary.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/record-summary.ts).

## R11 · A scenario-change link does not identify a scenario change

**S2 · Current diagnostic target construction and navigation**

**User journey.** Use Inspect originating scenario change N from an unresolved route or collision diagnostic.

**Observed.** The target contains only {type:scenario,id:scenarioId}. The change ID exists in the label but not the navigation target. Targets are deduplicated by scenario ID. The summary contains a scenario count, not a selected authored change. The repair message says revise, while the change rows expose Remove and Add rather than Edit.

**Why it matters.** The advertised repair target is not delivered; users must search a scenario and reconstruct its change.

**Required outcome.** Navigate to the actual change, show its human-readable description and affected records, and provide a bounded revise operation or accurately label the remove/re-add workflow.

**Acceptance.** Multiple responsible changes in one scenario remain independently addressable. Clicking a change diagnostic reveals that exact change.

**Source:** [src/ui/scenario-changes.ts:300-438](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/scenario-changes.ts#L300-L438); [src/ui/record-summary.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/record-summary.ts).

## R12 · Scenario authoring still uses unbounded, preselected control lists

**S2 · Current scenario builder source**

**User journey.** Create a scenario over an enterprise with hundreds of services and many planned changes.

**Observed.** Unlike the new record pickers and relationship pages, the scenario builder eagerly lists all services, merge targets and networks in native selects and renders every change row. It defaults to merge and preselects available source/target records.

**Why it matters.** The largest planning workflow retains the old scanning burden. Accidental default intent and same-name selection are more difficult to spot. Pixel overflow and performance were not measured here.

**Required outcome.** Reuse qualified searchable selectors and bounded change browsing, show deliberate intent, and expose clear empty/prerequisite states. Do not add another wizard.

**Acceptance.** Author and locate changes among 500 services, duplicate names and 100 changes without manual dropdown scanning; no arbitrary default becomes a change without deliberate submission.

**Source:** [src/ui/scenario-changes.ts:15-142](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/scenario-changes.ts#L15-L142); [src/ui/scenario-changes.ts:295-326](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/scenario-changes.ts#L295-L326).

## R13 · Startup failure has no user-facing boundary

**S2 · Source failure-path review; fault injection still required**

**User journey.** Open a damaged/incompatible standalone file or encounter an SQLite/WASM initialization failure.

**Observed.** The source shell initially contains an empty app element, and main ends with void boot() without a top-level user-facing failure handler.

**Why it matters.** An initialization rejection can leave a blank page and a console-only diagnosis. A user has no next step or application identity.

**Required outcome.** Render a minimal loading/failure shell that survives initialization failure, names the app build, provides safe troubleshooting and never implies that user data was erased.

**Acceptance.** Inject boot/WASM failure in the exact built offline HTML and verify a visible, accessible failure state and an actionable recovery instruction.

**Source:** [sim.html](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/sim.html); [src/main.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/main.ts).

## R14 · The normal Save shortcut is not wired to dataset saving

**S2 · Source-confirmed missing handler; native browser behavior not retested**

**User journey.** Use Ctrl+S or Command+S while working with a local document.

**Observed.** The reviewed global handler supports dataset Undo/Redo; workspace supports F2. No dataset Save shortcut is wired in these interaction owners. The browser retains its own default behavior.

**Why it matters.** A file-centric application leaves a highly familiar saving gesture outside its document model. Native-dialog consequences are not claimed from this source inspection.

**Required outcome.** Implement and advertise a tested Save-file shortcut, with correct modal ownership and native file-picker user activation. Or explicitly explain the unavailable shortcut until supported.

**Acceptance.** Test Ctrl+S/Command+S with clean, dirty, invalid, pending-composer and modal states using the distributed file in supported browsers.

**Source:** [src/main.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/main.ts); [src/ui/workspace.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/workspace.ts).

## R15 · Legacy issues are truncated without a persistent repair surface

**S2 · Current dataset-open path**

**User journey.** Open a structurally readable imported/legacy dataset with more than three semantic issues.

**Observed.** Open summarizes the first three issues, then more issues remain. This text is a transient global message and does not expose the complete issue set with record-level repair targets.

**Why it matters.** An engineer cannot determine whether the starting picture is trustworthy or work through the remaining defects.

**Required outcome.** Provide a session-visible, complete, paginated issue list tied to exact records and repair actions. Preserve unrelated work and do not block the whole assessment for unrelated issues.

**Acceptance.** Open a fixture with at least five issues; every issue remains discoverable after another edit and can be traced to its records.

**Source:** [src/main.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/main.ts).

## R16 · A successful-change error suggests reopening without first protecting work

**S2 · Current shell failure text**

**User journey.** A repository change succeeds but part of the presentation fails to refresh.

**Observed.** The message recommends selecting another item or reopening the file. The newly applied work may not yet be saved. Existing discard guards reduce risk; this is not proof of automatic data loss.

**Why it matters.** The recommended troubleshooting step can put the user on a path to discard the very change that succeeded.

**Required outcome.** Offer a safe view refresh first. If reopening is necessary, explicitly protect changes with Save a copy before reopening and describe which state will be read.

**Acceptance.** Inject a subscriber/rendering failure after a successful mutation. Recovery instructions and actions preserve applied unsaved data.

**Source:** [src/main.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/main.ts).

## R17 · Navigation records the outer editor scroll, not the editing body

**S2 · CSS and context capture source; integrated journey still required**

**User journey.** Scroll deeply within a service editor, navigate through a resolved edit, then use Back to restore the editing context.

**Observed.** Editing CSS sets the outer editor overflow to hidden and gives .editor-body overflow:auto. Editor viewContext and restoreViewContext use element.scrollTop on the outer editor.

**Why it matters.** The advertised return-context restoration omits the actual editing-body scroll position. This can force the user to reconstruct where they were working.

**Required outcome.** Capture and restore the active scroll owner for each inspector/editor mode, after the retained section is laid out. Preserve intentional draft decisions.

**Acceptance.** Record inner scrollTop and focused control before a deep-edit navigation. Back restores the correct section, inner scroll and meaningful focus without resurrecting discarded data.

**Source:** [src/ui/app.css:790-850](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/app.css#L790-L850); [src/ui/editor-panel.ts:1615-1745](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L1615-L1745); [src/ui/workspace.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/workspace.ts).

## R18 · Help and entry documentation retain misleading or implementation-level language

**S2 · Current help/README and rendered headings**

**User journey.** A new solutions engineer follows the bundled instructions to begin a real assessment.

**Observed.** Help calls As-Is the saved baseline although it displays current applied unsaved edits. The first-map example says to use a temporary .sqlite location. README Quick start begins with npm install/build. The editor explains metadata, builder choice and completed commands in a long warning-like paragraph.

**Why it matters.** The mental model of current/saved/proposed data is wrong, and onboarding still reads partly as instructions for a tester or developer.

**Required outcome.** Define As-Is as current recorded baseline and separately show saved status. Separate a clearly labeled practice tutorial from real-project steps, use an approved durable save location, and lead end users to the packaged HTML rather than a build command.

**Acceptance.** A first-time user can explain what Apply, Save, As-Is and To-Be mean and can begin a real named enterprise without following developer setup.

**Source:** [src/ui/help.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/help.ts); [README.md](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/README.md); [src/ui/editor-panel.ts:879-901](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/editor-panel.ts#L879-L901).

## R19 · A zero-result filter has no dedicated map empty state

**S2 · Current map visibility and empty-hint source**

**User journey.** Combine valid Network and Category filters that match no services in a populated dataset.

**Observed.** The map-empty hint is driven by whether any network exists in the full graph, not the filtered visible graph. The scope line remains, but there is no clear No records match / Clear filters state in the empty canvas.

**Why it matters.** An empty map can look like missing data rather than an intentionally narrowed scope.

**Required outcome.** Distinguish new dataset, zero filtered results, invalid focus, failed rendering and no dependency links. Give the correct recovery action without rearranging nodes.

**Acceptance.** Each empty state names its cause, offers the appropriate action and preserves saved positions.

**Source:** [src/map/map-view.ts:665-795](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L665-L795); [src/map/map-view.ts:1145-1160](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L1145-L1160).

## R20 · About exposes the database engine version but not the application build

**S2 · Current shell and release metadata**

**User journey.** A user reports a problem from a copied standalone HTML file.

**Observed.** About includes SQLite version. The reviewed UI does not show a SIM release/build commit identity. The release download and current main differ substantially.

**Why it matters.** Support cannot reliably establish what code the user is running from the in-app information.

**Required outcome.** Show SIM version, build commit/date, data-format version, and a copyable safe support-information summary. Never include inventory contents by default.

**Acceptance.** The distributed artifact identifies itself accurately even offline, and the identity matches the release manifest/checksum.

**Source:** [src/main.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/main.ts); [package.json](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/package.json).

# Missing capabilities for enterprise discovery

These should be introduced minimally and optionally. Do not turn discovery into a mandatory CMDB questionnaire. No missing-data state should fabricate a provider, network, verified connection or criticality score. A narrower inventory-map release can explicitly defer capabilities rather than advertise them as complete.

## G01 · Evidence and uncertainty belong to the record or connection

**Current model.** Service descriptions and support notes exist, but Dependency has only endpoints and optional CDS; no source, verification date, assessor or uncertainty state.

**As the arriving engineer.** I heard that Orders uses Identity, but have not validated it. The diagram has no way to distinguish that from established knowledge.

**Smallest useful addition.** Optional source/evidence note, observed date and verification state; distinguish unassessed, reported, verified and explicitly confirmed-none without forcing a form-filling exercise.

**Source:** [src/domain/types.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/domain/types.ts)

## G02 · Capture unresolved observations without inventing topology

**Current model.** A service requires a network; there is no discovery observation/question item or accountable follow-up record. Organization has name and parent only.

**As the arriving engineer.** I know a service exists, but not where it runs or which team can validate its dependencies. I must use external notes or create a misleading placeholder network.

**Smallest useful addition.** A lightweight unassigned-observation / open-question list that can later resolve to real records, with optional responsible contact/team. Unknown must not masquerade as a network or a verified absence.

**Source:** [src/domain/types.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/domain/types.ts); [src/ui/forms.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/forms.ts)

## G03 · Explain why the enterprise needs each service

**Current model.** Purpose can be free text in description; no structured mission/capability relationship, criticality or required-versus-optional dependency.

**As the arriving engineer.** Reducing service or cross-network counts cannot tell me whether a proposed consolidation preserves essential capabilities.

**Smallest useful addition.** Optional purpose/capability and impact tags, criticality with a human-defined scale, and dependency importance. Do not auto-generate a maturity score or invent weights.

**Source:** [src/domain/types.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/domain/types.ts); [src/map/map-view.ts:1215-1262](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L1215-L1262)

## G04 · A connection needs an explanation, not just endpoints

**Current model.** A dependency has no independent description, logical interface name, business use, source or validation note. CDS routing is a single optional reference.

**As the arriving engineer.** The line cannot explain what is exchanged, why the consumer needs it, or what a reviewer should validate.

**Smallest useful addition.** Optional logical relationship description and evidence. Keep dependency direction distinct from data-flow direction. Preserve service-level scope; no mandatory host/IP inventory or live reachability claim.

**Source:** [src/domain/types.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/domain/types.ts)

## G05 · Repeatable inventory export and reconciliation

**Current model.** Import is append-only. Existing names are returned as already present before incoming values are applied. Receipts now exist and are complete; they are not an export of the current inventory.

**As the arriving engineer.** A corrected spreadsheet from another team cannot update the same inventory cleanly, and I cannot give that team a product-generated current-state table for validation.

**Smallest useful addition.** Current-state tabular export first, then an explicit field-diff update mode using stable identity across rename/move. No silent overwrite and no delete-by-omission.

**Source:** [src/import/engine.ts:150-230](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/import/engine.ts#L150-L230); [src/ui/import-dialog.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/import-dialog.ts); [src/ui/import-receipt.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/import-receipt.ts); [src/domain/types.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/domain/types.ts)

## G06 · Reproduce a briefing, not merely download a picture

**Current model.** Positions persist, but MapViewState stores filters/focus/view/viewport in runtime navigation only. Capture takes the current viewport; it is not a durable named view or dated assessment snapshot.

**As the arriving engineer.** I prepare a boundary view today and must reconstruct it tomorrow. A screenshot cannot establish its evidence date or distinguish the assessment from current later edits.

**Smallest useful addition.** Small named view definitions and an explicit capture context/date; separate view presets from immutable assessment baselines. Preserve one-click current-view capture.

**Source:** [src/map/map-view.ts:30-42](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L30-L42); [src/map/map-view.ts:843-925](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L843-L925); [src/map/map-view.ts:1340-1379](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L1340-L1379); [src/domain/types.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/domain/types.ts)

## G07 · Target-network planning is still narrower than network consolidation

**Current model.** Scenario operations add, retire, merge and rehome services over baseline networks. No scenario-only network or CDS creation/retirement/route authoring is represented by the change union.

**As the arriving engineer.** A future network that does not yet exist cannot be represented as a purely proposed network without using baseline records as a workaround.

**Smallest useful addition.** Treat this as a separate scope decision after release defects and evidence capture. Introduce only the target-topology operations demonstrated by a real consolidation journey. Do not advertise a complete migration workbench yet.

**Source:** [src/domain/types.ts:133-185](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/domain/types.ts#L133-L185)

# Language and unfinished-state cleanup

Do not hide real unknowns. No description recorded, No dependencies recorded and connectivity not verified are useful, honest information. They are not development placeholders. A bare question mark, impossible suggested action, misleading absence claim or internal ID without a meaningful name is different.

| Current wording | Better outcome or wording | Condition |
|---|---|---|
| No provider | Provider not recorded | Do not infer confirmed absence from a null reference. |
| No matching records. Try another name or create one. | No matching services. Try another name. | Offer Create only where that action exists; otherwise provide a deliberate parent-preserving next step. |
| Service changes are still pending. | Organization changes are still pending. | For parent-organization creation; derive the actual parent noun. |
| As-Is: The saved baseline | As-Is: the current recorded enterprise, including applied changes not yet saved to file | Saved status is separate from baseline versus proposal. |
| Comparison status: rehomed. | Proposed move: Operations → Enterprise | Explain the actual before/after instead of serializing an enum. |
| As-Is service #17 | Orders · Operations | Keep IDs available in optional diagnostics, not the main explanation. |
| Inspect originating scenario change 42 | Review: Move Identity to Enterprise | The action must reveal that exact change, not just a scenario summary. |
| Unapplied draft across all sections | Changes not yet applied | Do not use a global reassurance while connection sub-editors are outside that draft. |
| Committed document has unsaved changes | Includes changes not saved to file | Avoid transaction language in a detached briefing. |
| No changes yet: this scenario matches As-Is. | No proposed changes yet. | The scenario follows later baseline edits; do not imply a frozen saved snapshot. |
| …more issues remain | Review all 7 issues | Only use an actual count and a real persistent review action. |
| Choose a temporary .sqlite location | Choose an approved, durable location for this enterprise file | Temporary locations belong only in an explicitly labeled practice exercise. |
| Something went wrong; nothing was changed. | Name the failed operation and the actual state retained | Prove rollback before claiming nothing changed; successful mutation/presentation failure needs distinct wording. |
| Remove or revise a change to repair it. | Open the affected change and provide Edit, or explain Remove and re-add | A revise instruction must have an actual operation behind it. |

# Remaining integrated verification risks

## V01 · Higher-marked import preview versus current dataset banners

**Source-observed labeling mismatch; visual/policy acceptance not established.** The receipt computes a highest recognized incoming marking and displays that value. App banners remain based on the current dataset repository until a commit changes it. Test a synthetic higher-marked rejected/held row over a lower-marked dataset: the modal should clearly identify its handling scope. No data leak or legal/compliance conclusion is asserted.

[src/main.ts](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/main.ts); [src/ui/import-dialog.ts:346-405](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/import-dialog.ts#L346-L405); [src/ui/import-receipt.ts:30-51](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/ui/import-receipt.ts#L30-L51)

## V02 · A restored focused view does not restore its focus-return checkpoint

**Source-state risk; exact end-to-end sequence not executed.** captureView includes focus but not focusReturn. restoreView restores focus without rebuilding focusReturn. Back-from-focus uses only that separate variable. Verify history sequences that exit focus, then restore an older focused context; the visible return action must not become inert.

[src/map/map-view.ts:464-480](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L464-L480); [src/map/map-view.ts:1340-1379](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L1340-L1379)

## V03 · Connection geometry can cross an unrelated network container

**Explicit current display limitation, not a new verified regression.** applyRouteOffsets considers visible leaves and network heading text, not entire unrelated network containers. README correctly calls it bounded avoidance rather than a full obstacle router. Inspect a seven-network synthetic map for false transit implications. Do not infer network reachability from geometric intersection.

[src/map/map-view.ts:797-840](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/src/map/map-view.ts#L797-L840); [README.md](https://github.com/SUaDtL/SIM/blob/55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121/README.md)

## V04 · Exact-artifact browser and native-file acceptance remains open

**Current-session verification limitation.** The complete current built application was not available to execute in this audit environment. Current-source traces, component Chromium tests and controlled handler probes are not full app acceptance. Native file picker permission/refusal, reload/close, concurrent writer and recovery-file readback require the actual distributed HTML.



# Final acceptance journeys

**Every journey below is NOT RUN against the full current production artifact in this audit.** The focused probes establish only their narrower recorded claims. Do not turn this catalog into a green checklist by copying inherited test totals.

## J01 · First-day enterprise setup

Start from the delivered HTML, name the enterprise after entering two services, save, close, reopen, capture a correctly titled view.

Traceability: R05, R06, R18, R20. Status: **not run on full production application**.

## J02 · Capture an uncertain interview fact

Record an unverified dependency, its source and an open ownership question without marking it verified or creating a fake network.

Traceability: G01, G02, G04. Status: **not run on full production application**.

## J03 · Apply an unfinished dependency choice

Choose provider/route, skip Add dependency and invoke Apply, Save and Apply-and-continue. The choice is applied or explicitly retained for completion.

Traceability: R01. Status: **not run on full production application**.

## J04 · Apply an unfinished consumer choice

Choose a consuming organization, skip Add consumer, then Save. No successful result silently discards it.

Traceability: R01. Status: **not run on full production application**.

## J05 · Finish or cancel a route task

Choose a new route but do not Use route; navigate, Save, Apply and Cancel. The active route task is consistently resolved.

Traceability: R02. Status: **not run on full production application**.

## J06 · Inspect pending versus saved connection

Inspect newly staged and route-modified rows. The inspector shows their pending state or clearly identified saved state.

Traceability: R03. Status: **not run on full production application**.

## J07 · Remove a map-focus subject

Focus a service, delete/retire/merge it, switch view and return. Remaining map records stay visible and the invalid focus is explained.

Traceability: R04. Status: **not run on full production application**.

## J08 · Nested focus and Back

Enter/exit focus, navigate, use workspace Back and Back from focus. Each visible return action reaches a valid earlier scope.

Traceability: V02. Status: **not run on full production application**.

## J09 · Missing-reference creation and no-match states

Test every picker empty/no-match/create/cancel path, including organization parent and dependency/source service. Text and actions match the task.

Traceability: R08, R09. Status: **not run on full production application**.

## J10 · Explain the proposed enterprise

Inspect moved, planned, merged and retired services, and follow diagnostics to individual authored changes. No unexplained IDs or dead repair actions.

Traceability: R10, R11, R12. Status: **not run on full production application**.

## J11 · Correct an imported enterprise inventory

Reimport updated ownership or descriptions. Present a truthful no-update explanation until an explicit reconciliation mode exists. Export current rows for review.

Traceability: G05. Status: **not run on full production application**.

## J12 · Legacy defects remain repairable

Open five semantic defects, review every issue, perform unrelated work and resume the issue list.

Traceability: R15. Status: **not run on full production application**.

## J13 · Failure after a successful change

Inject renderer failure after commit, protect data, recover the view and save. No misleading rollback or unsafe reopen instruction.

Traceability: R16. Status: **not run on full production application**.

## J14 · Startup failure

Inject SQLite/WASM startup failure in distributed HTML; a visible failure shell and exact build identity survive.

Traceability: R13, R20. Status: **not run on full production application**.

## J15 · Keyboard Save and deep edit return

Exercise Ctrl/Cmd+S and Back while deep in Support/Connections with populated collections. Restore body scroll/focus.

Traceability: R14, R17. Status: **not run on full production application**.

## J16 · Explicit empty map states

Empty dataset, zero filtered results, missing focus and render failure each show the right cause/action.

Traceability: R04, R19. Status: **not run on full production application**.

## J17 · Handling labels on import previews

Use only synthetic data: higher recognized incoming marking, rejected/held rows and unreadable input over a lower-marked dataset. Verify unambiguous preview labels and receipts.

Traceability: V01. Status: **not run on full production application**.

## J18 · Briefing repeatability and route readability

Prepare a seven-network boundary view, inspect complete paths and all omissions, reopen next day and recover the intended view.

Traceability: G06, V03. Status: **not run on full production application**.

## J19 · Real file and recovery lifecycle

On supported Edge/Chrome offline file://: Save, Save As cancel/refusal, recovery writes/readback, external conflict, reload/close and interrupted work. Record exact methods and untestable denial states.

Traceability: V04. Status: **not run on full production application**.

## J20 · Delivered bytes and fresh-user task test

Identify checksum/build in the actual downloaded artifact. A solutions engineer unfamiliar with SIM completes setup, edit, inspect and capture without author coaching.

Traceability: R05, R20, V04. Status: **not run on full production application**.

# Shipping decision

First resolve R01–R04 and bind a new accepted artifact to R05. Correct the misleading copy, identity and recovery guidance in the same stabilization pass where practical. Keep the new UI architecture; do not add a third interface, a new agent platform, or another global workflow framework.

Then run the exact downloaded HTML through the full journeys in supported browsers, including actual native-file behavior. Preserve any environment limitations instead of declaring unobserved branches passed. Show the artifact to a solutions engineer who has not been coached through the implementation. Record task errors and false conclusions, not merely whether controls were clickable.

For assessment usefulness, prioritize G01 and G02 before broad scenario expansion: the tool needs to represent knowledge and uncertainty honestly. Add current-state export and reproducible briefing views next. Broader consolidation operations remain a separate scoped product decision.

A smaller honest product is preferable to a richer interface that loses input or visually overstates what is known. This report is a negative readiness finding, not an unconditional guarantee that no additional defects exist.
