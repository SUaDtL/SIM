# Connected UX independent review

Review scope: all 73 mandatory cases, current application diff and browser assertions. Independent reviewer `sim_f26_review` inspected security, correctness, UX, DX and agent handoff clarity. Pure relationship/navigation and focus authors also supplied scoped evidence; author checks are not represented as independent approval.

## Findings corrected

- HIGH: initial/existing aggregate warning showed a scalar match while omitting changed support-note matches, then confirmation committed both. Independently reproduced in Chrome. Repository now collects all changed scalar/support findings before any write; exact draft signatures withdraw edited acknowledgements. New RED/GREEN unit and browser assertions cover it.
- HIGH: delayed Open installed another dataset underneath an old Back decision; answering that dialog navigated using old IDs in the new session. Independently reproduced in Chrome. Session, request, owner and draft-token guards now reject stale decisions; the unchanged integrated browser regression checks the nested modal race.
- MEDIUM: ordinary route refusals lacked repair targets. Repository errors now carry exact typed consumer/provider/CDS identities from stored data; field errors open read-only owner peeks. Scenario and deletion diagnostics use the same typed navigation boundary.
- MEDIUM: keyboard-following a reverse link replaced the focused peek button and left focus on BODY. Actual Chrome RED, then a focusable updated heading restores focus inside the same dialog. Closing returns to the original invoking control.
- MEDIUM: child fields retained parent `aria-describedby` references after ID prefixing. Actual browser RED. One ID mapping now rewrites label and ARIA token references together.
- MEDIUM: outcome severity inferred from message words mislabeled a refused dataset as neutral. Actual Chrome RED. Call sites now specify severity; projection-refresh partial failures retain truthful successful-write text with error severity.
- Capture progress/cancellation, unresolved former-CDS provenance, and focus labels falsely implying strict filters were applied gained explicit assertions after observed failing controls.
- To-Be/Compare layout could fail when hidden planned nodes were part of pinned fcose inputs. A temporary all-node layout precondition plus guaranteed view restoration handles strict filters and focus; browser cases assert no saved-position or history mutation.

The final strict case audit additionally reproduced and corrected three navigation details:

- Back had restored records/context but attempted to focus a detached original control. A bounded bookmark resolves the matching rebuilt control within its original region and restores focus without scrolling.
- A physical map tap let Cytoscape select a node before the async unapplied-work decision, leaving a blue selected border even after Stay. Native Cytoscape selection is disabled; admitted chainRoot owns visible selection.
- A merge into a planned service produced a virtual dependency endpoint whose inspector lacked precise provenance. It now shows the actual scenario and planned change identity from projection metadata, with no baseline edit action.

The unchanged strict regressions passed in both browsers as part of the final **42/42** focused navigation/editor/projection run. Final source review covers these changes separately from prior review.

## Boundaries

The first-time empty-dataset journey is exercised through ordinary UI controls: start a service, create its missing network/provider, add initial relationships, save and reopen. Keyboard peek/return, two viewport sizes and actual synthetic image exports supplement source review. This is agent/browser evidence, not a user usability study or screen-reader certification.

Numeric line/branch coverage is unmeasured under CTX-TECH-STACK FACT-002. Pure-focus negative controls killed reversed traversal, removed boundary selection and a missing CDS segment. Picker stubs do not prove native OS permission behavior. F26 native recovery/external-writer acceptance remains separate. No dependency, migration, runtime network or browser-persistent dataset storage was introduced.

Final scoped independent security/correctness/UX/DX/AX verdict: PASS, including the last three source corrections. Final full gate: 342 unit / 296 browser tests pass; all 73 individual cases pass. Hosted exact-head CI and native F26 acceptance are separate. See TEST-RESULTS.md.
