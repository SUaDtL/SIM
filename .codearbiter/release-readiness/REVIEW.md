## Review verdict — SIM release-readiness stabilization bounded follow-up

**Status:** PASS

Current active findings: none. Both original MEDIUM / DEFERRABLE findings are retained below with evidence-supported RESOLVED states. This is a complete, bounded review verdict; it does not establish native, participant, hosted CI, merge or publication acceptance.

| Disposition | Current count |
|---|---:|
| BLOCKS | 0 |
| DEFERRABLE | 0 |
| NON_BLOCKING | 0 |
| INCOMPLETE_RESULT findings | 0 |

### Current findings

Explicit none. Current CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0. No new finding was supplied or invented.

### Retained finding history

Historical findings: two; both originated with coverage-auditor, both retain original severity MEDIUM and original triage disposition DEFERRABLE, and both are now RESOLVED. Applicable control for each: n/a. Resolution is supported by the producer's bounded reassessment and inspected coordinator-executed regression/readback evidence; it is not a severity downgrade, waiver, deduplication or decision to defer.

### Resolved finding COV-R02-01

**Disposition:** RESOLVED by current code and direct production-layer regression evidence. The original source-causal finding is preserved below, not deleted, downgraded or waived.

Current repair at editor-panel.ts:796–811 checks whether the retained provider's route control is attached. If absent, it clears an excluding dependencies query, calculates the precise provider's page using the existing shared page size, and rebuilds the collection before resolving the route control. Existing routeIntents rehydration restores its candidate. The refusal then places its instruction at and focuses that actual route control, not an unrelated Add composer. This is a view-only recovery: no repository mutation occurs before Use/Cancel and normal Apply.

New production-browser regressions use 25 dependencies with the pending route on the second page. Four combinations cover search-hidden/page-hidden × Apply/Save. They assert the control was absent before the operation, then visible and focused afterward, candidate retained, excluding query cleared, exact provider/page present, no download, and no Undo/write. Use route and Cancel route are exercised separately; actual exported/read-back bytes retain all 25 dependencies and the intended new or original CDS respectively. The original one-row redraw regression remains unchanged.

Inspected editor-hidden-route-red.log: all four Chrome cases fail specifically because the exact route remains unavailable after Apply/Save. Inspected review-findings-green.log: all eight corresponding Chrome/Edge host cases pass. These are coordinator-executed results inspected by this reviewer, not tests executed here.

**Historical finding, now resolved:**

#### COV-R02-01 — Applying an off-page unfinished route focuses the unrelated addition composer

**Severity:** MEDIUM
**File:** src/ui/editor-panel.ts:795 / e2e/readiness-editor.spec.ts
**Description:** The new route intent survives redraw, but its refusal recovery looks for the route select only in the currently attached DOM (lines 795–799), then falls back to Add dependency or Add consumer (lines 805–809). The existing paginated relationship collection attaches only its current filtered page (lines 1425–1428). After changing a route without Use route, search for another dependency or navigate to another dependencies page, then Apply or Save. The route intent remains and correctly prevents the write, but the pending route's Use route/Cancel route controls are absent. Focus and the inline Finish the route choice cue are instead placed at an unrelated Add control. The user must reconstruct the missing route and its page/query to complete the required operation. The current redraw regression has one dependency and does not cover this bounded-list transition.
**Evidence:** Causal trace of routeIntents, the DOM-only refusal lookup/fallback, and pageRows filtering. Not newly executed by this reviewer; no data-loss assertion.
**Remediation:** Before displaying the unfinished-route refusal, reveal the exact provider in the dependency collection (clear an excluding query and select its page, or provide a direct Resume route action), reattach the retained route task, and focus its actual route/Use/Cancel control. Add a full offline-app regression with more than 20 dependencies and a filtered-away pending route, assert visible retained candidate and useful focus, then Use/Cancel and saved-file readback.


### Resolved finding COV-R12-02

**Disposition:** RESOLVED by current code and saved/projected positive controls. The original model meaning is preserved; no unassignment capability was invented.

ReferencePickerOptions adds an optional caller-owned noneLabel, with the old No assignment default preserved for existing reference-clearing callers. Scenario provider selection supplies Keep existing provider for Re-home and Provider not recorded for Add; the backing empty option and refreshed choice use matching wording. The selected value is still the existing null sentinel, so rehome follows the established current-provider retention contract.

The new offline-app journey starts from a service assigned to Synthetic operations. It checks the Re-home empty action is Keep existing provider, explicitly rules out No assignment, selects the action and adds the change. Actual saved-byte readback plus applyScenario confirms both the destination Blue network and the retained provider. The same journey then chooses Add's Provider not recorded and confirms the saved/projected planned service has null provider. This exercises both context-specific meanings rather than checking text alone.

Inspected provider-choice-red.log: the correct Keep existing provider action is missing on the pre-fix artifact. Inspected review-findings-green.log: the two Chrome/Edge host cases pass. The shared component's fallback label and allowNone guard remain intact; no new actionable defect was identified in the bounded delta.

**Historical finding, now resolved:**

#### COV-R12-02 — Re-home provider picker offers No assignment for a Keep existing provider choice

**Severity:** MEDIUM
**File:** src/ui/scenario-changes.ts:151 / src/ui/reference-picker.ts:153 / e2e/readiness-scenario.spec.ts
**Description:** The new shared scenario provider picker uses allowNone for both Add and Re-home, but the shared picker always labels the empty choice No assignment. In a Re-home change the underlying empty option is (unchanged), and the scenario engine explicitly retains the existing provider for null (src/scenario/scenario.ts:146). For a service with an existing provider, choosing No assignment therefore retains that provider rather than removing its assignment. This is a new mismatch between the advertised picker action and the proposal's meaning. The current large-scenario test exercises source selection and retirement but not this context-specific empty provider choice.
**Evidence:** Causal trace of addPicker allowNone, reference-picker empty option and rehome provider null-coalescing. Not newly executed by this reviewer.
**Remediation:** Let the caller supply a context-specific empty-choice label, such as Keep existing provider for Re-home and Provider not recorded for Add; preserve the existing model semantics rather than inventing unassignment. Add a Re-home journey with a currently assigned provider, exercise the empty choice, and assert both truthful visible wording and the projected/saved change's provider retention. Retain normal No assignment behavior in other callers that actually clear an assignment.

### Safety reassessment


The complete safety follow-up supplies explicit zero findings. It confirms that revealing a retained route changes only the dependency collection query/page and attached view, preserves the service draft and candidate, and does not perform a repository, file or node-position write. The existing Apply refusal still controls Save/navigation/capture until Use or Cancel.

It also confirms that noneLabel is caller-owned text rendered through DOM text children; the ordinary No assignment fallback and current picker guard remain. Keep existing provider and Provider not recorded still choose the model's existing empty sentinel in their distinct contexts. No unassignment, inference, host-like-text confirmation bypass, classification change or write authority is introduced. Prior complete security controls and zero-finding conclusions remain applicable to unchanged paths.

### Completeness and admission

The complete final-triage-followup.md was the sole finding input. Its actual original-byte SHA-256 was verified as 3ee412993dc81d85f15786a95e1c1c1beb27a9c679325742e8a66b142a32955a. The complete current review-contract.json was read. No source, source manifest, raw producer report, test log or application behavior was independently inspected by this aggregator.

| Expected producer | Terminal result | Supplied finding result |
|---|---|---|
| coverage | DONE | No active findings; two original MEDIUM findings retained and RESOLVED |
| safety | DONE | Explicit none: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0 |

Expected producers 2 / DONE 2 / ERRORED 0 / DEFERRED 0 / MISSING 0. Triage DONE 1. Aggregator DONE 1. Both expected units have explicit terminal results and complete reports. No historical finding, resolution evidence, failure or qualification was omitted or downgraded.

Base commit: 55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121. Current reviewed source epoch: c39fc0d36340a7cf041ecd018917ae18c694249424f1a35ab216e8c91b1f54fe. Prior epoch: b6b15d30174f35f3e1cbab390adcb084e78072dbef02aa155a9e12485cdf2494. Triage reports both producers independently verified all 146 current manifest hashes before and after inspection. The bounded five-path delta covers editor-panel.ts, reference-picker.ts, scenario-changes.ts, readiness-editor.spec.ts and readiness-scenario.spec.ts. Aggregation verified report admission and completeness, not those hashes or source behavior independently.

Verified producer-report digests retained by triage: coverage 992783c31ca90024b8ea5b709420cae286e888bf469d39fe1f2a1ed3b1eaeb05; safety adb9f28c36450dcbc1c4596674f8fff00a3be94bfc752b0103fc11e1fb733ba5. The original reports, triage and aggregate remain preserved.

### Verification boundary

The sole triage packet records 10 passing targeted Chrome/Edge host checks on coordinator build6: eight hidden-route checks and two provider-choice checks. These were coordinator-executed logs inspected by the producers, not producer-, triage- or aggregator-executed tests.

The packet records full-check-2.log as still running at the producers' final observation. That historical observation is preserved. The original complete gate's 694/716 result with 22 failures and the later 50/50 correction run remain historical results, not substitutes for a final complete gate. Numeric line/branch coverage remains unmeasured under the declared no-tooling exemption.

Subsequent coordinator report, separate from the sole finding input and not independently read or verified here: full npm run check exited 0, with 393 unit tests and 726 Chrome/Edge browser tests passing in full-check-2.log. This separate report does not alter the producer or triage observation times.

### Scope and external qualification

R05 accepted publication and exact downloaded-byte verification remains OPEN. G01–G07 remain capability gaps. The coordinator additionally reports G01/G02 are selected only for next scoping, with G03–G07 future work; no implementation or acceptance of those capabilities is asserted by this review. V03 remains an explicitly disclosed bounded geometry limitation, not a complete obstacle router. V04 physical/native picker and permission behavior, physical reload/close, concurrent-writer/recovery qualification and real uncoached participant acceptance remain separate and unclaimed. No merge or publication authority is created.

### Execution integrity

Read and verified the complete current contract and complete sole follow-up triage packet, then composed this aggregate. No source, raw producer report or test log was opened; no tests, builds, browser operations or subagents were launched. No repository, native artifact, Git state, dataset or existing report was changed. The only write is this newly owned TEMP result under the coordinator's explicit output instruction.
