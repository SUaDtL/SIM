## Review verdict — SIM release-readiness stabilization

**Status:** PASS

This is a complete, bounded review verdict with two MEDIUM DEFERRABLE findings. PASS means no triaged BLOCKS finding and no incomplete review unit. It does not waive these authorized repairs, certify an all-green repository gate, or establish native, participant, merge or publication acceptance.

| Disposition | Count |
|---|---:|
| BLOCKS | 0 |
| DEFERRABLE | 2 |
| NON_BLOCKING | 0 |
| INCOMPLETE_RESULT findings | 0 |

### Findings

| Source | Severity | Location | Disposition | Finding | Remediation / control |
|---|---|---|---|---|---|
| coverage-auditor | MEDIUM | src/ui/editor-panel.ts:795 / e2e/readiness-editor.spec.ts | DEFERRABLE | COV-R02-01 — Applying an off-page unfinished route focuses the unrelated addition composer. The new route intent survives redraw, but its refusal recovery looks for the route select only in the currently attached DOM (lines 795–799), then falls back to Add dependency or Add consumer (lines 805–809). The existing paginated relationship collection attaches only its current filtered page (lines 1425–1428). After changing a route without Use route, search for another dependency or navigate to another dependencies page, then Apply or Save. The route intent remains and correctly prevents the write, but the pending route's Use route/Cancel route controls are absent. Focus and the inline Finish the route choice cue are instead placed at an unrelated Add control. The user must reconstruct the missing route and its page/query to complete the required operation. The current redraw regression has one dependency and does not cover this bounded-list transition. | Before displaying the unfinished-route refusal, reveal the exact provider in the dependency collection (clear an excluding query and select its page, or provide a direct Resume route action), reattach the retained route task, and focus its actual route/Use/Cancel control. Add a full offline-app regression with more than 20 dependencies and a filtered-away pending route, assert visible retained candidate and useful focus, then Use/Cancel and saved-file readback. Evidence: Causal trace of routeIntents, the DOM-only refusal lookup/fallback, and pageRows filtering. Not newly executed by this reviewer; no data-loss assertion. Applicable control: n/a. |
| coverage-auditor | MEDIUM | src/ui/scenario-changes.ts:151 / src/ui/reference-picker.ts:153 / e2e/readiness-scenario.spec.ts | DEFERRABLE | COV-R12-02 — Re-home provider picker offers No assignment for a Keep existing provider choice. The new shared scenario provider picker uses allowNone for both Add and Re-home, but the shared picker always labels the empty choice No assignment. In a Re-home change the underlying empty option is (unchanged), and the scenario engine explicitly retains the existing provider for null (src/scenario/scenario.ts:146). For a service with an existing provider, choosing No assignment therefore retains that provider rather than removing its assignment. This is a new mismatch between the advertised picker action and the proposal's meaning. The current large-scenario test exercises source selection and retirement but not this context-specific empty provider choice. | Let the caller supply a context-specific empty-choice label, such as Keep existing provider for Re-home and Provider not recorded for Add; preserve the existing model semantics rather than inventing unassignment. Add a Re-home journey with a currently assigned provider, exercise the empty choice, and assert both truthful visible wording and the projected/saved change's provider retention. Retain normal No assignment behavior in other callers that actually clear an assignment. Evidence: Causal trace of addPicker allowNone, reference-picker empty option and rehome provider null-coalescing. Not newly executed by this reviewer. Applicable control: n/a. |

### Completeness and admission

The complete finding-triage report was the sole finding input. Its actual SHA-256 was verified as 67328e848f51e1d9ea05d8a0db725509296a600231b954515355906854cbc699. The complete current batch contract was read. No raw reviewer report, source, test, source manifest or application behavior was independently inspected by this aggregator.

| Expected producer | Terminal result | Retained finding result |
|---|---|---|
| coverage | DONE | CRITICAL 0 / HIGH 0 / MEDIUM 2 / LOW 0 |
| safety | DONE | Explicit none: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0 |

Expected producers 2 / DONE 2 / ERRORED 0 / DEFERRED 0 / MISSING 0. Triage unit DONE 1. Aggregator DONE 1. Both findings appear exactly once above; no finding was omitted, downgraded, reinterpreted, deduplicated away or invented. DEFERRABLE retains triage's MEDIUM classification; it is not owner acceptance or an instruction to omit the repairs.

Base commit: 55986ee2a078ccfdc4f09dbe62ddd7fd5b8f2121. Final reviewed source epoch: b6b15d30174f35f3e1cbab390adcb084e78072dbef02aa155a9e12485cdf2494. Triage reports both producers verified all 146 manifest entries at that epoch with zero mismatches and retained the initial epoch and five-path bounded delta. The aggregator verified packet admission and completeness, not source hashes.

### Verification and release boundaries

The original full repository gate ended with 694 of 716 browser cases passed and 22 failures; it is not an all-green gate. The coordinator's correction log reports 50 of 50 focused Chrome/Edge cases passed, including real 200/400-percent browser zoom; it does not replace the complete gate. Numeric line/branch coverage remains unmeasured under the declared no-tooling exemption. No browser check was run by this aggregator.

R05 remains OPEN for separately authorized publication and accepted downloaded-byte verification. G01–G07 remain separate capability gaps. V03 remains an explicitly disclosed bounded geometry limitation, not a completed obstacle router. V04 native picker/permission, physical reload/close, concurrent-writer/recovery readback and real uncoached participant acceptance remain unqualified. No merge or publication authority is created.

### Execution integrity

Read the installed ca-review and verdict-aggregator instructions, complete current contract and complete sole triage packet; verified the triage digest. No repository, native artifact, Git state, dataset or existing file was modified. No tests, builds, browser operations or subagents were launched. The only write is this newly owned TEMP result under the coordinator's explicit output instruction. An initial parse attempt stopped before any write because the input used CRLF; parsing normalized line endings after verifying the unchanged original byte digest.
