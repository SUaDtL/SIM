# Integrated UAT completion contract

`UAT-COVERAGE.json` contains **180 proposed integrated acceptance cases** across boot/help, document actions, all seven entity types, pickers, relationships, reuse, navigation, scenarios, map, capture, imports, native recovery, accessibility/visual review and release gates. None is marked passed by this session. A component-support field means only the specified isolated behavior was checked.

## Inventory reconciliation

At the receiving HEAD, enumerate every rendered button, menu item, tab, field, keyboard shortcut, empty-state action, error-recovery action and conditional confirmation from the current source and real browser. Include native fallbacks and hidden/disabled states. Compare that inventory with existing E2E names and this matrix. Add omissions instead of asserting that this proposed list is mechanically exhaustive.

## Required per-case record

Record candidate commit/tree, built HTML SHA-256, fixture identity, exact browser/channel/OS/zoom, start state, ordinary user actions, visible result, resulting dataset state, expected result, screenshot/trace/output file, console/network failures and test status. For mutations, inspect the resulting data and Undo/Redo, not only the success message. For captures, open the downloaded bytes rather than inspecting only a mock callback.

Use statuses: not_run, passed, failed, blocked_environment, inapplicable_with_reason. Do not count skipped, adapter-only, source-reviewed or externally reported cases as integrated passes. Retain failed evidence and a passing rerun linked to the fixing commit.

## Human-style journeys

A. From no knowledge to a first map: name enterprise, create a service and missing network/provider inline, add purpose/support/dependency, save/reopen, explain the result.

B. Interview interrupted: edit a parent and a child, switch sections, inspect a related service, cancel an operation, resume, Apply and Save. Include clean-parent/dirty-child reload.

C. Reuse safely: find shared assets, distinguish current assignment, create a similar service on another network, opt into support copy, verify independent identity and no copied routes.

D. Discover a boundary: use filters, Depends on, Used by and Network connections with shared providers/CDS, expand deliberately, remove a focused subject, return, and verify remaining context.

E. Compare a proposal: add/retire/merge/rehome, inspect consequences and unresolved routes, reach the exact originating change, and return to As-Is without mutation.

F. Reconcile an import review: preview mixed files, replace a slow file selection, review all refusals, confirm exact flagged rows, import once, inspect receipt, Undo and retry corrected input.

G. Brief another engineer: create a focused view, explain omissions/marking/current state, export PNG/SVG and inspect them at presentation size, identify the exact application build.

H. Survive failure: actual native save/cancel/refusal, file conflict, recovery update/readback and committed-render-error handling with synthetic-only files.

## Role of automation

Keep the existing complete gate. Add regressions for the findings. Automated success is necessary but cannot establish uncoached comprehension or aesthetic quality. Use actual browser zoom and supported assistive technology where promised. A smaller CSS viewport is only a reflow probe, not a replacement for those checks.
