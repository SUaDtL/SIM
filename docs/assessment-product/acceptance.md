# Acceptance protocol: assessment product

**Initial status for every case below: not run.** This file defines proposed acceptance, not observed behavior or completed work. Historical software results are cited in the proposal README for context only.

The [specification](spec.md) is the behavior oracle. The [plan](plan.md) maps work packages to these cases. Every case ID is `AC-AP-` plus its three-digit number. Ranges in the plan expand to individual cases; a passing aggregate suite does not replace case-level evidence.

## 1. Evidence rules

Record case ID, requirement IDs, source commit/tree, HTML SHA-256, data/schema fixture identity, environment, method, actual steps/results, artifacts, limitations, and date. Allowed results are **not run**, **passed**, **failed**, **partial**, **blocked environment**, or **blocked participant**. A documented owner risk decision is separate, never a fabricated pass.

Distinguish unit/property tests, component DOM tests, integrated offline browser tests, actual native-file operations, assistive-technology observations, and real uncoached participants. Stubs establish adapter behavior only. Synthetic-role analysis is not a human focus group. No invented completion times, user quotes, satisfaction scores, or certification.

Use fictional UNCLASSIFIED data in repository fixtures and public evidence. Test marking propagation according to the current approved synthetic test policy in controlled local artifacts; never commit real customer information. Sanitize support/evidence logs without altering the substance of a failure.

## 2. One end-to-end assessment fixture

Use a fictional organization, **Aster Works**. Its current picture includes Enterprise, Operations, Development, Partner, and External SaaS networks; approximately 100 services for the primary journey; and variants at the measured sizes in AP-19.

Include two distinct Identity services on different networks, Orders on Operations, a shared Platform organization, distinct provider/support/consumer roles, a valid CDS route, a no-CDS-recorded boundary dependency, a dependency cycle, an unused shared application, and long qualified names. Explicitly include blank optional fields, a readable legacy issue, and repeated names that are not duplicate identities.

The brief contains inconsistent owner statements, one outdated document assertion, an unresolved reporting capability with unknown hosting, a dependency question, and an organization correction received after a local edit. Include a scenario that retires a focus target and a saved view whose target later disappears. No brief asserts that the recorded inventory is the whole enterprise.

The narrative is: start an assessment, record interview facts without placeholder topology, inspect a useful boundary/path view, capture questions and evidence, export a review to Platform, receive corrections, resolve a conflict, apply a bounded batch change, save/reopen, and brief a recipient with the report. Include cancellation and interruption between steps.

## 3. Case register

### Current product and interaction preservation

#### AC-AP-001

**Requirements:** AP-19, AP-20

Pin receiving main and reconcile historical records/addenda. Preserve exact source and method limits; do not transfer old acceptance to new bytes.

#### AC-AP-002

**Requirements:** AP-01, AP-20

Run prescribed static/build/unit/offline gates and identify the resulting file. Observe no runtime external requests or dataset browser persistence; record missing environments honestly.

#### AC-AP-003

**Requirements:** AP-01, AP-02

From an empty file add a network/service with only existing required inputs, connect, capture, Save, and reopen. New assessment features add no mandatory fields, wizard, or named-view step.

#### AC-AP-004

**Requirements:** AP-01, AP-02

Create a provider inline while parent fields/relations are pending. Child cancel and validation refusal preserve parent state; successful creation is distinct from parent Apply and file Save; Undo follows the documented independent commands.

#### AC-AP-005

**Requirements:** AP-01, AP-02

Enter only meaningful child text, an unadded dependency, a route edit, and a question draft in separate runs. Apply/Save/navigation/reload/close never silently lose these tasks or substitute a different payload. Native page-loss branch uses a real browser.

#### AC-AP-006

**Requirements:** AP-01, AP-02

Apply field/support/dependency edits together; inject validation and post-commit rendering failures. SQL/history semantics and messages distinguish refusal from committed data with failed presentation.

#### AC-AP-007

**Requirements:** AP-01, AP-02

Create similar service on another network. Shared references are reused, source unchanged, new identity independent, no route/consumer/position/verification copied by default.

#### AC-AP-008

**Requirements:** AP-02

Browse/peek/edit/Back through duplicate-named records while preserving section scroll, exact identities, keyboard focus, pending work, and map framing. Stay cancels navigation effects.

#### AC-AP-009

**Requirements:** AP-02, AP-19

Exercise all new controls at laptop and narrow widths and genuine browser zoom using keyboard. Controls, dialogs, errors, and footer remain reachable; current assignment is not conveyed by color alone.

#### AC-AP-010

**Requirements:** AP-01, AP-02

Switch records, scenarios, or datasets during report/capture/picker work. Old completions keep their own bytes/name and do not alter the new session or its feedback.

### Assessment context, identity, and views

#### AC-AP-011

**Requirements:** AP-03, AP-18

Edit optional assessment scope/exclusions/as-of information, Undo/Redo, Save/reopen/recover. Dataset name remains the sole title; empty scope means not recorded; metadata edits do not alter topology/positions.

#### AC-AP-012

**Requirements:** AP-11, AP-18

Upgrade an old file in memory, cancel Save, and reopen original. Original bytes remain unchanged; no old record becomes reviewed. After Save/reopen, stable exchange identities persist with internal IDs unchanged.

#### AC-AP-013

**Requirements:** AP-11

Compare New, Save As, and Create similar service. New assessment gets a new lineage; Save As retains lineage; copied service receives a new identity. Equal names never imply identity equality.

#### AC-AP-014

**Requirements:** AP-11, AP-13

Diverge two Save As copies; rename a service in one and delete/recreate a dependency in another. Base/precondition checks prevent cross-copy overwrite or old evidence attaching to a new incarnation.

#### AC-AP-015

**Requirements:** AP-11, AP-18

Attempt actionable review issuance before new identity/base is durably saved; cancel or fail each save/export step. No false-ready review, loss of the base, or unusable silently issued package; read-only unsaved reports remain labeled.

#### AC-AP-016

**Requirements:** AP-07

Save three viewpoints: boundary, ownership-filter, and scenario focus. Reopen the file and restore exact scope/question and usable framing on the same viewport.

#### AC-AP-017

**Requirements:** AP-07, AP-01

Restore, Fit, navigate, and return from a saved view. Inventory, node positions, Undo stack, and saved checkpoint remain unchanged. Save/rename/delete of the definition itself is undoable.

#### AC-AP-018

**Requirements:** AP-07

Delete a view's subject or scenario. Restoration explains the stale reference; no silent As-Is substitution, all-record exposure, or blank-success map. Repair is explicit and can be cancelled.

#### AC-AP-019

**Requirements:** AP-07, AP-02

Restore on a different viewport and with a pending service draft. Preserve draft/positions and apply the documented framing adjustment; no implicit Apply.

#### AC-AP-020

**Requirements:** AP-07, AP-18

Edit inventory after saving a view. The view shows latest data while a previously exported dated report remains unchanged; neither is mislabeled as the other. Malformed/deep view data is bounded/rejected safely.

### Outputs and decision views

#### AC-AP-021

**Requirements:** AP-08, AP-09

Export assessment and inventory from the fixture. Scope, exclusions, names, roles, schema/build/source checkpoint, generation date, row counts, captions, and declared omissions agree. No fictitious evidence section in I1.

#### AC-AP-022

**Requirements:** AP-08, AP-01

Export with a pending draft, later edits, render failure, cancellation, and dataset replacement. Current-state versus Apply-and-export is explicit; frozen output is coherent; failed rendering does not undo an already applied change.

#### AC-AP-023

**Requirements:** AP-09, AP-10

Round-trip supported typed values containing Unicode, multiline text, commas, nulls, empty strings, and formula-leading text. Human CSV is spreadsheet-safe and never silently changes exact interchange values.

#### AC-AP-024

**Requirements:** AP-08, AP-10

Export a Platform-scoped review/report. Inspect visible text, images, HTML source, JSON, metadata, accessibility text, filenames, and print output. No unrelated record/note is present; required boundary context is explicit and minimal.

#### AC-AP-025

**Requirements:** AP-10, AP-18

Hidden higher-handling source content and assessment-level notes are omitted from a focused output. Handling floor/caveat never drops through filtering; annotation edits and legacy migration cannot lower source marking.

#### AC-AP-026

**Requirements:** AP-08, AP-10

Open the report offline and print it with long names, dense views, and hostile markup strings. No executable user content or external fetch; labels and critical explanations remain readable and scoped.

#### AC-AP-027

**Requirements:** AP-16

Matrix shows consumer-network rows and provider-network columns; a CDS-routed logical dependency counts once. Drill-down exposes exact identities and returns to the original scope. Zero is recorded count, not proven isolation.

#### AC-AP-028

**Requirements:** AP-16, AP-17

Compare baseline/proposed/compare tables with graph projections, including retired ghosts and unresolved routes. Before/after populations are explicit; no double counting or invented direct connectivity.

#### AC-AP-029

**Requirements:** AP-17, AP-15

Responsibility view separates provider, support tiers, and explicit consumer roles. Unknown assignments remain not recorded; optional gaps are not structural failures.

#### AC-AP-030

**Requirements:** AP-17

Trace direct/transitive paths through cycles and shared providers/CDS. Direction is correct, unrelated consumers excluded, work bounded, truncation disclosed, and wording does not predict outages.

### Evidence, uncertainty, and open questions

#### AC-AP-031

**Requirements:** AP-04

Add evidence to a specific provider assertion and dependency route. Basis/source/review state are independent and visible; neither creates a blanket verified-service claim.

#### AC-AP-032

**Requirements:** AP-04

Review a provider assertion, then change category/viewport and later provider. Only the relevant change marks applicability needs review; old source/reviewed value remains available.

#### AC-AP-033

**Requirements:** AP-04, AP-05

Record conflicting interview/configuration sources. No last-writer-wins replacement; disputed information and its actual targets remain understandable.

#### AC-AP-034

**Requirements:** AP-05

Compare blank provider/dependency set, explicitly confirmed absence, and not applicable. Each is distinct; adding conflicting recorded information makes prior absence outdated without blocking corrective entry.

#### AC-AP-035

**Requirements:** AP-05

Calculate review counts under a filter and after new records are added. Denominator names the recorded population; no unknown-enterprise coverage percentage or automatic health score.

#### AC-AP-036

**Requirements:** AP-06

Record an unknown-hosting observation before a service/network exists. No placeholder topology is created; later linking does not automatically resolve or verify it.

#### AC-AP-037

**Requirements:** AP-06

Resolve and reopen a question with source/reason. Preserve prior resolution, optional assignment, Undo, and Save/reopen state without introducing mandatory ticket fields.

#### AC-AP-038

**Requirements:** AP-06, AP-18

Delete a target with evidence/questions. Consequences are explicit; assessment knowledge remains detached with former identity; Undo restores links. Recreated same-name target is not auto-linked.

#### AC-AP-039

**Requirements:** AP-01, AP-04, AP-10

Edit sensitive evidence/question text after confirmation; navigate or close with child-only input. Exact acknowledgement and loss protection hold; source locators never fetch automatically.

#### AC-AP-040

**Requirements:** AP-04, AP-05, AP-18

Migrate, import, or create similar services from reviewed records. No automatic reviewed status, source attribution fabrication, or inherited confirmed absence. New annotation tables participate in all persistence/history checks.

### Owner review and correction reconciliation

#### AC-AP-041

**Requirements:** AP-08, AP-12

Prepare organization review with provided/supported/consumed roles and questions. Recipient sees exact records and reviewable questions; exported does not claim received or authenticated reviewer identity.

#### AC-AP-042

**Requirements:** AP-10, AP-11, AP-12

Tamper with review scope/base/IDs or return a pack without trusted issuance. Refuse unsafe automatic acceptance and provide a nonmutating manual review path; never trust a self-declared base.

#### AC-AP-043

**Requirements:** AP-11, AP-12

Inspect issuance cancellation/failure/reopen and a different assessment lineage. Durable base and scope survive valid delivery; incompatible or non-issued material cannot update current records.

#### AC-AP-044

**Requirements:** AP-13

Exhaust the B/C/R truth table per scalar/reference field. Unchanged proposal preserves current edit; identical current/proposal is no-op; divergent local/proposed values require explicit conflict resolution.

#### AC-AP-045

**Requirements:** AP-13

Test omitted rows, omitted fields, empty string, explicit clear, and explicit set. No omission becomes deletion/clear; invalid clear of a required value is refused visibly.

#### AC-AP-046

**Requirements:** AP-11, AP-13

Rename/move qualified labels and use identical names across networks. Correct only the issued stable identity; deleted/recreated or mismatched target is quarantined, not guessed/recreated.

#### AC-AP-047

**Requirements:** AP-13

Change a relevant field/reference after preview; separately change only unrelated layout/record data. Relevant stale plan is refused; unrelated changes do not invalidate an identical accepted effect.

#### AC-AP-048

**Requirements:** AP-13, AP-18

Inject late SQL/domain/history failure into multiple accepted corrections. All accepted effects and history roll back; explicit refusal/skipped items remain reviewable; no partial success is reported.

#### AC-AP-049

**Requirements:** AP-13

Repeat a committed return, Undo, then intentionally re-review/reapply it. Replay is idempotent; Undo/reapply works; historical receipt is not a live count or irreversible consumed flag.

#### AC-AP-050

**Requirements:** AP-12, AP-13

Submit topology, marking, deletion, unknown-field, oversized/deep or unsupported-format proposals. Unsupported suggestions remain visible without mutation; current append-only CSV behavior remains unchanged.

### Maintenance, real usability, performance, and delivery

#### AC-AP-051

**Requirements:** AP-14

Batch assign a provider/category/support role across paged/filtered explicit selection. Preview full scope and exact before/after values; no hidden targets or silently changed support notes.

#### AC-AP-052

**Requirements:** AP-14

A selected item/reference changes after preview or becomes invalid. Refuse the batch with navigable causes and no partial writes; explicit deselection/re-preview succeeds.

#### AC-AP-053

**Requirements:** AP-14, AP-01

Apply and Undo/Redo a valid batch. Restore all affected data in one step; manual positions, unrelated fields, and scenario independence remain intact; no-op batch adds no history.

#### AC-AP-054

**Requirements:** AP-14, AP-15

Contrast assigning an organization with renaming the shared organization. Consequence scope is visible and correct; structural issues and assessment gaps remain separate.

#### AC-AP-055

**Requirements:** AP-15

Flag possible duplicate organizations/applications with reasons and usage. Do not merge automatically or flag separate network-specific service instances as identical by name alone.

#### AC-AP-056

**Requirements:** AP-02, AP-17, AP-19

Measure declared 100/500/2,000-service fixtures on recorded hardware/browser bytes. Record cold/warm p50/p95 and memory; search, paging, cancellation, bounded path expansion, and output remain usable. Publish only measured support limits.

#### AC-AP-057

**Requirements:** AP-01, AP-02, AP-19

Real uncoached engineers complete the synthetic assessment using in-app help only. No silent loss/mislinking; record wrong turns, task results, and explanation of pending/applied/saved/shared states. Re-test corrected blockers.

#### AC-AP-058

**Requirements:** AP-08, AP-19

Real recipients unfamiliar with SIM explain scope, one path, responsibility roles, uncertainty, and proposed versus current information from the exported report. No coaching or fabricated participant results.

#### AC-AP-059

**Requirements:** AP-18, AP-19, AP-20

Retrieve the exact candidate and verify hashes/source/report identities. Reopen same bytes offline; perform real native save/recovery/conflict and real screen-reader/zoom checks. Distinguish unsupported/unavailable cases from passes.

#### AC-AP-060

**Requirements:** AP-19, AP-20

Review complete requirement/case evidence, help, migrations/older-build warning, operating limits, release notes, and owner risk decisions. No release sign-off from tests alone and no release publication without explicit authority.

## 4. Real-participant protocol

Initial proposed sample: three engineers/curators with mixed familiarity and two separate briefing recipients. Reusing one person for both tasks must be disclosed; it does not establish independent recipient comprehension. This is qualitative evidence, not a statistically representative study.

Give engineers only the fictional brief, the candidate, and these goals: establish the assessment; capture contradictory/unknown information without inventing facts; produce a useful boundary view; request and reconcile a team correction; save/reopen; and leave a maintainable handoff. Existing Help is permitted. Do not name menu paths or tell them which control to click.

For I0, evaluate only current implemented capabilities and record the missing assessment workflows as product needs, not implementation failures. For I1 and I2, add only the capabilities in that candidate. Do not penalize an I1 candidate for unshipped I2 requirements or claim those requirements passed.

Ask recipients to explain scope/exclusions, trace one dependency, identify provider versus support, distinguish reported from reviewed information where available, identify the most important unresolved question, and state whether a view is current, proposed, or a dated export. Report what they actually understood.

Record consent for research observations, anonymized participant role/familiarity, candidate identity, tasks, interventions, wrong turns, and actual outcomes. Do not collect real enterprise data. Stop and record the point of failure if the task loses work or misleads identity/scope. Fix and rerun affected tasks; retain the original observation.

Proposed qualitative release criterion: all tested core tasks complete without operator coaching, no silent loss or wrong-record changes, and recipients correctly understand the scope/meaning of their handoff. Assistance, partial completion, or misinterpretation is evidence to address, not something to relabel as success. Owner exceptions remain explicit risks.

## 5. Integration and artifact review

Run the current prescribed gate and retain exact logs. Examine actual HTML/CSV/JSON/PNG/SVG outputs, not only data assertions. Search output source and metadata for out-of-scope values. Reopen upgraded files and test older-build refusal on a copy. Exercise annotation/view/review changes against file checkpoints, recovery, Undo triggers, and preview conflict semantics.

Retain native and actual assistive-technology evidence separately from mocks and automated accessibility checks. A build opened through a development server does not establish offline `file://` behavior. Actual browser zoom is separate from resizing a viewport. Print rendering and briefing-size readability need direct inspection.

The receiving integrator should add cases for newly discovered controls/edges without deleting these obligations. Store execution results outside this normative case definition, keyed by stable IDs, to avoid making a plan look like a completed release report.
