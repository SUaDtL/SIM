## Test Audit Review — bounded findings reassessment — 2026-11-15

Unit: coverage. Producer terminal state: DONE.

**Current active findings:** CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0.
**Historical findings retained and resolved:** COV-R02-01 (MEDIUM), COV-R12-02 (MEDIUM).
**Current scoped gate status:** PASS. This is a bounded code/test reassessment, not a full local gate, hosted CI, native or release certificate.

### Subject and context

Reviewed current source epoch c39fc0d36340a7cf041ecd018917ae18c694249424f1a35ab216e8c91b1f54fe against prior reviewed epoch b6b15d30174f35f3e1cbab390adcb084e78072dbef02aa155a9e12485cdf2494. Read the complete refreshed review-coverage.json (reviewer_input and delivery_text), review-contract.json and review-source.json. Required instruction admission is ready, without missing refs or blockers; optional map/provenance remain advisory. The caller's actual repair scope and source/host epochs remain separate from imported audit evidence and plan labels.

All 146 current manifest hashes independently matched before and after inspection. The exact five-path delta is:

- src/ui/editor-panel.ts
- src/ui/reference-picker.ts
- src/ui/scenario-changes.ts
- e2e/readiness-editor.spec.ts
- e2e/readiness-scenario.spec.ts

No unchanged source was reaudited merely to repeat the prior fleet. Prior conclusions remain bounded to their recorded epochs and the new source delta is assessed below. The initial report is preserved unchanged at final-coverage.md, SHA256 b1f01b82ce4d9c8f9993e091b0a075f8d60fcf95cfdd861c0cb5168ce0e5cc81; *.epoch2 inputs/reports were not modified.

### Coverage

Profile: no-tooling exemption | Scope: SIM TypeScript app/build | Hosts: Windows Node unit tests, offline file:// Chrome and Edge browser tests.
Required numeric metrics: none configured | Stage: 1; configured coverage would require 60 percent.
Unmeasured: lines and branches. No numeric coverage percentage is inferred from test counts.

Retained exact CTX-TECH-STACK#FACT-002 citation:
> No numeric coverage command or provider is configured in package.json or Vitest configuration. Unit checks use npm test and browser checks use npm run e2e. Lines and branches remain unmeasured; no numeric coverage pass is claimed.

Status: PASS for these two repaired behavioral obligations; complete current local/hosted verification is separate.

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


### Current findings

CRITICAL: none. HIGH: none. MEDIUM: none. LOW: none.

### Verification and acceptance limits

The coordinator reports an observed exit 0 for the ten targeted host cases in review-findings-green.log on its root build6 candidate (C819…); the inspected log shows 10 passed. The relevant implementation and tests match the independently verified current source manifest. The reviewer did not launch tests/builds, did not measure numeric coverage, and does not convert this focused run into exhaustive qualification.

At final inspection full-check-2.log was still running (Chrome cases in progress). The previous full-check.log failure (694/716) is retained historically and is not relabeled as success. The complete local gate and exact-head hosted CI remain coordinator-owned. R05 accepted-publication/download qualification remains open; G01–G07 stay separate product capabilities; V03 remains explicitly disclosed bounded route geometry; V04 physical/native and uncoached participant acceptance remain unclaimed. No merge, publication or human acceptance is asserted.

### Execution integrity

Read-only bounded source, test and evidence inspection with before/after hash verification. No test/build/native/Git/dataset/browser action, repository mutation, reviewer dispatch or external post. The only newly owned write is TEMP final-coverage-followup.md. All original reports and epoch2 inputs remain unchanged.
