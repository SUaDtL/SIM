## Finding Triage Report — bounded follow-up — 2026-11-15

Terminal state: DONE. Current active reviewer findings: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0. Two original MEDIUM findings remain recorded below with the coverage reviewer's supported RESOLVED dispositions; neither was omitted, downgraded or waived.

### Subject and complete batch admission

Target: SIM release-readiness stabilization against main55986ee2. Current reviewed source epoch: c39fc0d36340a7cf041ecd018917ae18c694249424f1a35ab216e8c91b1f54fe. Prior reviewed epoch: b6b15d30174f35f3e1cbab390adcb084e78072dbef02aa155a9e12485cdf2494.

Read the complete current review-contract.json and both complete follow-up producer reports. Verified both report SHA-256 values against their delivered digests. The installed finding-triage instructions and repository stage-1 context remain the owning classification instructions. Both producers were actually DONE before follow-up classification began.

| Unit | Terminal state | Verified report SHA-256 | Current findings |
|---|---|---|---|
| coverage | DONE | 992783c31ca90024b8ea5b709420cae286e888bf469d39fe1f2a1ed3b1eaeb05 | Explicit none active; two original MEDIUM findings retained and RESOLVED |
| safety | DONE | adb9f28c36450dcbc1c4596674f8fff00a3be94bfc752b0103fc11e1fb733ba5 | Explicit none: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0 |

Both producers independently report all 146 current manifest hashes matching before and after their inspection. The bounded five-path delta is editor-panel.ts, reference-picker.ts, scenario-changes.ts, readiness-editor.spec.ts and readiness-scenario.spec.ts. Triage verified report admission and completeness, not source hashes or application behavior independently. No unchanged source was reaudited by triage.

The original reports and prior triage remain preserved. Original coverage report SHA-256: b1f01b82ce4d9c8f9993e091b0a075f8d60fcf95cfdd861c0cb5168ce0e5cc81. Original safety report SHA-256: b304638c56c965d09855ab186da92b0e950fe986bf60941b48a8d9a8a8c26ef8. Original triage SHA-256: 67328e848f51e1d9ea05d8a0db725509296a600231b954515355906854cbc699.

### BLOCKS — current findings

Explicit none. No current CRITICAL or HIGH finding was supplied.

### DEFERRABLE — current findings

Explicit none. No active MEDIUM finding remains in the complete follow-up result.

### NON_BLOCKING — current findings

Explicit none. No LOW finding was supplied.

### INCOMPLETE_RESULT — review batch

Explicit none. Expected producers 2 / DONE 2 / ERRORED 0 / DEFERRED 0 / MISSING 0. Triage unit DONE 1. Pending full-gate, hosted, native, publication or participant qualification is retained separately under the agreed batch scope, not converted into an invented incomplete producer.

### Retained historical findings and supported resolution

| ID | Source | Original severity and triage disposition | Current supplied disposition | Applicable control |
|---|---|---|---|---|
| COV-R02-01 | coverage-auditor | MEDIUM / DEFERRABLE | RESOLVED: exact retained route is revealed and focused after excluding query/page; current source and direct RED/GREEN/readback evidence inspected by coverage | n/a |
| COV-R12-02 | coverage-auditor | MEDIUM / DEFERRABLE | RESOLVED: caller-owned empty-choice labels match established Re-home/Add provider meanings; current source and projected/saved readback evidence inspected by coverage | n/a |

The original severity labels are unchanged. RESOLVED is the producer's evidence-backed follow-up state, not a lower severity or an authorization to defer a defect. No deduplication is necessary: the two historical findings remain distinct and fully retained. Complete supplied finding descriptions, source-causal evidence, remediation and resolution proof follow.

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

### Safety reassessment retained

The complete safety follow-up supplies explicit zero findings. It confirms that revealing a retained route changes only the dependency collection query/page and attached view, preserves the service draft and candidate, and does not perform a repository, file or node-position write. The existing Apply refusal still controls Save/navigation/capture until Use or Cancel.

It also confirms that noneLabel is caller-owned text rendered through DOM text children; the ordinary No assignment fallback and current picker guard remain. Keep existing provider and Provider not recorded still choose the model's existing empty sentinel in their distinct contexts. No unassignment, inference, host-like-text confirmation bypass, classification change or write authority is introduced. Prior complete security controls and zero-finding conclusions remain applicable to unchanged paths.

### Verification and acceptance boundaries

Coverage and safety inspected review-findings-green.log, which records 10 passing targeted Chrome/Edge host cases on the coordinator's build6. The four hidden-route variants produce eight host checks and the assigned-provider Re-home/Add journey produces two. Both producers explicitly distinguish coordinator-executed log evidence from reviewer execution. Triage did not launch or independently repeat any test or build.

full-check-2.log was still running at the producers' final observation. This packet does not assume a full-gate PASS or update that provider state. The original full-check.log result of 694/716 passed with 22 failures, and the later 50/50 bounded correction run, remain historical evidence rather than a substitute for the final complete gate. Numeric line and branch coverage remains unmeasured under the declared no-tooling exemption.

R05 accepted publication and exact downloaded-byte verification remains OPEN. G01–G07 remain separate capability gaps. V03 remains a disclosed bounded geometry limitation. V04 physical/native picker and permission behavior, physical reload/close, concurrent-writer/recovery qualification and real uncoached participant acceptance remain separate and unclaimed. No merge or publication authority is created.

### Summary counts

- Current active findings: 0.
- CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0.
- Current BLOCKS 0 / DEFERRABLE 0 / NON_BLOCKING 0 / INCOMPLETE_RESULT 0.
- Historical findings retained: 2 MEDIUM, both RESOLVED; none dropped or severity-downgraded.
- Expected producer units 2 / DONE 2 / ERRORED 0 / DEFERRED 0 / MISSING 0.
- Triage unit DONE 1.

### Execution integrity

Read-only admission and classification of supplied complete reports only. No new reviewer finding, independent source or behavior investigation, test/build/browser/native operation, repository/Git/dataset mutation or external post. The sole newly owned TEMP output is final-triage-followup.md under the coordinator's explicit instruction. No existing report or epoch input was modified. No subagents were dispatched.
