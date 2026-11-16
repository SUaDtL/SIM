# Work packages

One integrator owns shared picker/session contracts. Parallelize independent tests and review after interfaces are agreed. A review performed by an author is not independent approval.

## WP0: Bind an executable candidate and baseline
Depends on: none. Findings: WG09.

1. Read current AGENTS.md and governing records; preserve unrelated working changes.
2. Record receiving commit/tree and diff against this audit pin.
3. Build with current lockfile/toolchain; run the existing gate without skipping failures.
4. Retain candidate HTML, checksum, full build identity and reports as a verification artifact. Do not publish a release.
5. Enumerate actual UI actions and reconcile this matrix with existing tests.

Exit criteria:
- Exact artifact retrieved and hash checked.
- Existing baseline evidence recorded with real failures/limits.

## WP1: Close draft-awareness gaps before cosmetic changes
Depends on: WP0. Findings: WG04, WG08.

1. Reproduce child-only reload/close on a clean saved dataset with a real user gesture.
2. Track meaningful child input through an explicit loss-awareness contract without auto-creating shared data.
3. Differentiate context defaults from actual edits after contextual Add.
4. Preserve one-parent draft, exact acknowledgement and separate shared-child commit/Undo policies.

Exit criteria:
- Child-only loss guard regression executed.
- Untouched second-network creation cancels without phantom edits.
- Existing parent/route/scenario draft regressions stay green.

## WP2: Fix viewport and collection layout
Depends on: WP0. Findings: WG01, WG02, WG07.

1. Make floating menus viewport-aware with appropriate anchored fallback.
2. Restructure picker scroll ownership so essential controls stay usable.
3. Adapt relationship rows to narrow containers without smaller text or dropped network identity.
4. Keep the current dark theme, task surfaces and data model; no framework rewrite.

Exit criteria:
- Desktop and actual 200%/400% zoom screenshots inspected.
- All menu/dialog controls reachable, focus visible and no accidental horizontal document scrolling.
- Long populated lists tested at realistic size.

## WP3: Make reuse and empty states unambiguous
Depends on: WP0, WP2. Findings: WG03, WG06.

1. Render a visible Current assignment cue distinct from hover/focus.
2. Handle zero source records, zero eligible records and zero query matches separately.
3. Keep Create and use visible only when supported and reuse exact IDs.

Exit criteria:
- Empty first-service reuse path offers a feasible next action.
- Current record remains recognizable across filtering and pages.
- No blur, query or highlight auto-assigns a value.

## WP4: Remove misleading focus actions
Depends on: WP0. Findings: WG05.

1. Reproduce the enabled network expansion action on the actual candidate.
2. Hide/disable undefined expansion without adding new traversal semantics.
3. Make directed traversal exhaustion clear; preserve all route/projection identity guarantees.

Exit criteria:
- Network focus has no meaningless enabled Expand.
- Directed-chain, shared-CDS and cycle tests pass.
- Focus/fit never mutate data or saved arrangement.

## WP5: Complete integrated acceptance and independent review
Depends on: WP1, WP2, WP3, WP4. Findings: all integration gates.

1. Execute every applicable row in UAT-COVERAGE.json against the exact candidate.
2. Use real Chrome and Edge offline from disk, plus native save/recovery/conflict tests.
3. Record screenshots, traces, downloaded artifacts and dataset readback per test.
4. Apply the five synthetic role lenses and record hypotheses separately from observations.
5. Run an uncoached real-user task when available; do not represent synthetic review as that study.
6. Have a non-author reviewer inspect the evidence and changes.

Exit criteria:
- No unresolved high-risk defect and no silent blocked mandatory check.
- Every finding closed with exact-head evidence or explicit accepted limitation.
- Final recommendation only; no merge/release without approval.

## Scope control
No data-schema migration is expected for the stated UI fixes. Preserve the current schema and merged migrations. If a real need emerges, write and review the tradeoff rather than changing a historical migration. Add no dependency solely for this handoff. Reuse existing renderers, repository validation, ownership guards and error types.

## Safe resumption
Update receiving HEAD, working branch, candidate hash, last passed commands, active finding, changed files, known failures, blocked tests and next exact action after each completed slice. Do not overwrite unrelated local modifications or old evidence.
