# Synthetic focus-group review

Method: one assistant applied five role-based task lenses to observed components and inspected source. These are not human participants, independent reviewers, quotes, ratings, satisfaction scores or measured task-success rates.

## P1: Arriving solutions engineer
Goal: Record an interview without abandoning a partially entered service.

- C10/C11 preserve parent input in the picker protocol, with a synthetic child adapter.
- WG02 makes creation difficult to find in a populated list.
- WG04 identifies an unverified child-only page-loss path.

Hypothesis: The user may reasonably believe unfinished text inside the currently open child is protected by the same session guard as the parent.
Design decision: Keep Create and use in context, visible and explicitly committed; include child work in loss awareness.
Required actual task: Begin with a clean saved enterprise, add a missing provider while taking notes, interrupt and resume.
Evidence outcome: Partial component evidence; full interview journey not run.

## P2: Inventory curator maintaining shared assets
Goal: Reuse the correct organization/application and add many relationships efficiently.

- C02/C05 show explicit ID selection and bounded large-result paging.
- WG03 has no visible current-assignment indicator.
- WG06 exposes empty reuse choices with futile guidance.

Hypothesis: The curator may re-search a current assignment because it is visually indistinguishable from other records.
Design decision: Make current identity explicit; distinguish empty library from query failure; avoid duplicate shared records.
Required actual task: Update ten services using existing shared assets and create one new asset, without duplicates or wrong-network assignments.
Evidence outcome: Picker/collection mechanics tested; service/repository integration not run.

## P3: Architecture planner comparing alternatives
Goal: Understand network dependencies and propose changes without altering As-Is.

- F01-F04 confirm direction and complete logical CDS routes in the pure focus function.
- WG05 shows depth is ignored for network focus despite the UI expansion action.
- PR26 projected-summary/unfinished-route improvements were source-reviewed, not executed end to end.

Hypothesis: An enabled Expand button implies a broader view, so a refit with unchanged membership can be misread as a completed exploration.
Design decision: Make actions reflect the actual question; keep projection edits and baseline edits distinct.
Required actual task: Compare two proposals, inspect an unresolved route, follow the exact authored change, and return to the original scope.
Evidence outcome: Pure graph evidence only for focus; scenario UI journey not run.

## P4: Keyboard-first user working at enlarged text
Goal: Complete the same tasks without losing focus or reading word-by-word columns.

- C12/C14/C16/C17/C18 pass isolated navigation/return-focus checks.
- C19 passes viewport reflow in the picker; this is not actual zoom.
- WG07 shows secondary actions dominate narrow relationship rows.

Hypothesis: A technically non-overflowing layout can still impose substantial reading and scrolling effort.
Design decision: Preserve the information column, persistent picker controls and visible focus; evaluate actual zoom and screen-reader behavior separately.
Required actual task: Complete editing, inline creation, paging and capture at actual 200% and 400% browser zoom.
Evidence outcome: Isolated keyboard and CSS-width checks only; real zoom and assistive technology not run.

## P5: Briefing owner and receiving reviewer
Goal: Capture an understandable enterprise view and identify the exact application being used.

- WG01 clips About/support information in the source-matched desktop header.
- WG09 prevents independent qualification of the exact candidate.
- Actual current PNG/SVG downloads were not available to inspect.

Hypothesis: A visually polished map can be mistaken for verified completeness unless omissions, scope and source identity remain clear.
Design decision: Retain exact artifact identity and inspect real captures at presentation scale before sign-off.
Required actual task: Produce an operations-boundary capture and explain hidden information, classification and version to another reviewer.
Evidence outcome: Header-layout evidence only; current capture journey not run.

## Tradeoffs to resolve with evidence
A frequent curator may favor compact rows while a new engineer needs visible context. Keep useful identity and qualification rather than shrinking text. Show a stable current-assignment cue and bounded paging instead of repeating large action clusters. Persistent picker controls should not consume the entire short viewport. Creation stays in context but remains an explicit shared-record commit.

No broad new feature platform is proposed. Deferred discovery/evidence capabilities should remain separately governed product work.
