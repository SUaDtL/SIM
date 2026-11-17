# Implementation plan: assessment product

Read the [specification](spec.md) and use the [acceptance protocol](acceptance.md) as the case register. The [execution register](execution.md) records implementation and verification on PR 31. The owner directed every implementation slice to remain on that PR.

## 1. Delivery strategy

Deliver a dependable current release first, reusable outputs second, and evidence/review/maintenance as bounded later increments. No package is a license to rebuild the UI or implement autodiscovery. Each feature must simplify an actual assessment journey before increasing available controls or mandatory metadata.

A package has three independent dimensions: **implementation readiness**, **software verification**, and **receiving acceptance**. A component can be ready for downstream coding while real-native or participant acceptance remains blocked. Record that block honestly. It blocks the associated readiness/release claim, not unrelated documentation, fixture development, or isolated software testing.

Use one focused branch/PR per implementation slice, based on current main. Preserve unrelated working-tree changes. This documentation PR must not start implementation automatically, merge itself, publish a version, or mark native codeArbiter work complete.

## 2. Intake and authority

Before editing application code:

1. Read current `AGENTS.md`, `CONTRIBUTING.md`, project context/decomposition, governing ADRs and their lifecycle records. Read actual owning modules and tests, not filenames or comments alone.
2. Record receiving commit/tree, dirty worktree state, installed tool versions, and exact candidate identity. Compare with baseline `a2b84ef19f6e1ab880c032f79190aa9b434244f7` and preserve newer work.
3. Reconcile PR 30's acceptance record with its delivery addenda and later commits. Do not re-open resolved bugs by repeating old expectations, and do not mark native/human cases complete because software tests passed.
4. Promote accepted proposal scope through the installed codeArbiter workflow. Map `AP-*`, `AP-W*`, and `AC-AP-*` IDs into the native spec/plan/work records. Do not edit generated HTML or invent approval hashes/lifecycle events. Retain this proposal as provenance or replace it with an explicit pointer to the canonical accepted artifacts.
5. Baseline `npm run check` in the prescribed environment; capture logs and limitations. Use only fictional test data. Any unavailable native environment stays an explicit block.

No schema migration, new runtime dependency, or report/correction format ships merely because this plan names it. Resolve its scoped design decision and tests first.

## 3. Work packages and dependency graph

Dependencies below mean required integrated software/contracts, not a claim of completed human acceptance. I0 receiving gates apply before calling an increment release-ready. Parallel preparation is allowed after intake; keep the default rollout sequence unless pilot evidence justifies a documented change.

- **AP-W00: Intake and baseline**. Increment: I0; Depends on: None; Requirements: AP-01, AP-19, AP-20; Acceptance cases: 001, 002
- **AP-W01: Current-product pilot and qualification**. Increment: I0; Depends on: AP-W00; Requirements: AP-01, AP-02, AP-19, AP-20; Acceptance cases: 003-010, 057-060
- **AP-W02: Assessment context and identity**. Increment: I1; Depends on: AP-W00; Requirements: AP-03, AP-10, AP-11, AP-18; Acceptance cases: 011-015
- **AP-W03: Named viewpoints**. Increment: I1; Depends on: AP-W02; Requirements: AP-01, AP-02, AP-07, AP-18; Acceptance cases: 016-020
- **AP-W04: Inventory and assessment output**. Increment: I1; Depends on: AP-W02, AP-W03; Requirements: AP-08, AP-09, AP-10, AP-18; Acceptance cases: 021-026
- **AP-W05: Decision views**. Increment: I1; Depends on: AP-W04; Requirements: AP-02, AP-15, AP-16, AP-17; Acceptance cases: 027-030
- **AP-W06: Evidence and unresolved discovery**. Increment: I2a; Depends on: AP-W02; Requirements: AP-04, AP-05, AP-06, AP-10, AP-18; Acceptance cases: 031-040
- **AP-W07: Enriched handoff and owner review**. Increment: I2a/I2b; Depends on: AP-W04, AP-W06; Requirements: AP-08, AP-10, AP-11, AP-12; Acceptance cases: 041-043
- **AP-W08: Reviewed correction acceptance**. Increment: I2b; Depends on: AP-W07; Requirements: AP-11, AP-12, AP-13, AP-18; Acceptance cases: 044-050
- **AP-W09: Bounded upkeep**. Increment: I2b; Depends on: AP-W05, AP-W06; Requirements: AP-02, AP-14, AP-15; Acceptance cases: 051-055
- **AP-W10: Integrated usability and envelope**. Increment: Each release; Depends on: Relevant feature packages, AP-W01; Requirements: AP-01, AP-02, AP-19; Acceptance cases: 003-010, 056-058
- **AP-W11: Exact-candidate delivery**. Increment: Each release; Depends on: AP-W10; Requirements: AP-18, AP-19, AP-20; Acceptance cases: 059, 060

A subset release includes only its completed feature families. Do not require I2b to ship I1. Re-run affected earlier cases when later changes touch their contracts. AP-W10/W11 are repeated gates for each candidate, not a one-time finish line.

### AP-W00: Intake and baseline

Read the sources linked in [README](README.md#source-baseline), the current file/session owners, CI/release definitions, and the latest native acceptance records. Create an execution record binding each method/result to source commit, tree, HTML SHA-256, date, and environment.

Establish the current supported-user journeys and baseline operation counts. Inventory current controls so that new features do not duplicate existing reuse, issue review, capture, or recovery capabilities. Classify evidence as software, artifact, native, assistive technology, or participant. Record blockers separately from failures.

**Exit:** a receiving-source map, preserved worktree, reproducible baseline, and planned changes to normal governance records. No unsupported green status. A missing full environment does not justify changing acceptance criteria.

### AP-W01: Current-product pilot and qualification

Run the existing product before broad feature expansion. Use the synthetic brief and real-participant tasks in acceptance.md. Exercise actual downloaded offline bytes, genuine Save/Save As and refusal/cancellation, recovery readback, external-file conflict, actual browser zoom, keyboard paths, and a real screen reader where available.

Fix only observed defects necessary for core record/edit/reuse/save/inspect/capture journeys. Preserve the inline creation and separate child commit policy. Add regressions that fail before each fix. Record usability wrong turns and recipient misunderstandings, not only crashes. Separate an architecture limitation from an implementation defect.

**Exit:** current-product qualification report and a prioritized pilot correction list. Missing participants/native methods remain blocked or receive an explicit owner risk disposition; neither is labeled passed. No new required metadata. Release authority remains with the owner.

### AP-W02: Assessment context and identity

Review AP-D1 and AP-D2. Inspect `src/domain/types.ts`, repository CRUD/history/checkpoints, `src/db/dataset.ts`, migrations and exact-schema validation, `src/session/`, and file adapters. Follow established form/summary conventions for metadata; do not add another dataset title.

Design minimal schema families and indexes for assessment metadata and stable exchange identity. Decide relationship identity/incarnation rules before evidence or review packs use them. Preserve numeric primary keys, Save As lineage, independent copied-service identities, and cold reopen identity stability. Test divergent same-lineage copies and unsaved migration reopen; actionable review issuance requires a durable base.

Update semantic admission, trigger coverage, logical-content checkpoint, saved status, recovery serialization, size checks, and deterministic scoped serialization together. Old files remain untouched on open; upgrades are saved explicitly. Add actual old-file fixtures and unsafe/stale identity cases.

**Exit:** compatible, tested metadata/identity foundation with a visible useful feature and reviewed forward migration. Do not merge tables that have no consuming feature. **Rollback:** revert unreleased code; for migrated saved files restore a known pre-upgrade copy, not a down migration.

### AP-W03: Named viewpoints

Review AP-D4. Read `src/map/map-view.ts`, workspace navigation, focus/graph modules, and saved-position tests. Project current view state into a versioned data-only ViewSpec; exclude DOM and navigation-history state and cap nesting/depth. Reuse existing focus semantics.

Add Save view, restore, rename, and delete in the current map navigation without making named views a capture prerequisite. Share selection and pending-draft resolution. Validate referenced scenario/subject before restoration; require explicit repair of stale definitions. Preserve viewpoint meaning and current positions when viewport dimensions differ.

**Exit:** close/reopen three saved questions, restore each usable scope/framing, test stale/deleted/projected references, and prove zero inventory/position/history mutation during restoration. Saving a view itself is undoable and file-persisted. Per-view layouts remain excluded.

### AP-W04: Inventory and assessment output

Read `src/map/export.ts`, `src/map/svg.ts`, capture orchestration, existing CSV neutralization/receipts, and current classification logic. Review AP-D2 and the lossless-versus-human-CSV format. Define scope closure and data-only serializers first; do not embed a full dataset in the HTML for convenience.

Build inventory export with stable identities and a versioned manifest. Build self-contained read-only HTML from one frozen snapshot, with selected map captures, tables, scope/exclusions, generation/source identities, and print styling. Reuse frozen-capture ownership and actual failure semantics. I1 reports do not pretend evidence/questions already exist; AP-W07 enriches them later.

Test malicious and spreadsheet-formula-leading strings, duplicate names, Unicode, long values, excluded data in every serialized channel, dense map readability, print output, failed image rendering, and switching datasets while rendering. Keep record-level text as text, not HTML. Scope, marking/caveat, and included boundary context must agree.

**Exit:** an unfamiliar recipient can understand the report; CSV/JSON are correctly scoped, safe, and exact for their declared purpose. Current PNG/SVG remains one direct operation. Report review is separate from authority to distribute its contents.

### AP-W05: Decision views

Read domain types, snapshot generation, graph/focus traversal and identity adapters, organizational relation projections, scenario comparison, and current Inventory/Map navigation. Implement pure selectors for the network matrix, responsibility rows, and dependency-path explanations.

Count logical relations once. Keep roles, current/proposed/compare scope, unverified routes, zero recorded counts, and missing information distinct. Use cycle-safe, bounded traversal with controlled expansion; avoid all-path explosion. Drill-down and map focus share navigation state and Back.

Integrate selectors into the established bounded table/collection components, not a separate analytics dashboard. Export uses AP-W04's same scoped snapshot. Duplicate suggestions remain opt-in candidates for review, not an entity-merge command.

**Exit:** the pilot engineer answers a boundary/ownership/path question using records they can inspect, without inventing failure impact or moving saved positions.

### AP-W06: Evidence and unresolved discovery

Review AP-D5 and the annotation handling policy in AP-D2. Read aggregate-draft ownership, sensitive-input confirmation, deletion consequence planning, Undo history, and report/output serializers. Plan assertions around typed target/aspect plus reviewed value, not whole-record booleans.

Add optional evidence/questions sections and a small searchable assessment review list. Make unattached observations first-class without adding fake network nodes. Implement scoped absence findings, conflicting sources, reviewed-value invalidation, question resolution/reopen, and deliberate deletion retention. Labels must not claim enterprise completeness.

Review whether annotations are edited within the active aggregate or as explicitly separate commands. Resolve that boundary before UI work; no ad hoc immediate writes from an apparently pending form. Share draft/page-loss guards, including child-only notes. Do not copy verification to similar services or imported records.

**Exit:** an engineer records a partially known capability, attaches sources later, resolves one question, preserves another, and hands over distinguishable reported/reviewed/disputed information. Legacy records remain unspecified, not retrospectively verified.

### AP-W07: Enriched handoff and owner review

Enrich the AP-W04 report with selected evidence/questions and correct denominator disclosures. Review AP-D3. Define a bounded initial correction schema with explicit set/clear/no-proposal and versioning; specify stable reference resolution and formula-safe human exports separately from typed interchange.

Prepare review from explicit organizational roles, preview disclosure scope, and keep necessary endpoint context minimal. Persist the issuance/base binding and choose safe issuance/export ordering: cancellation/failure cannot create an apparently delivered review or discard the only durable base. Record package creation as **prepared/exported**, not proof the reviewer received it.

Start with a readable review packet before implementing update acceptance. The recipient must be able to identify the exact service and proposed field without learning the full application. A returned file is untrusted; claimed reviewer identity is not authentication.

**Exit:** a team-scoped pack can be produced and explained, reopens against its issuing saved base, and cannot expose unrelated data or mislead users about delivery. Corrections remain nonmutating until AP-W08 exists.

### AP-W08: Reviewed correction acceptance

Read existing `src/import/engine.ts` preparation/replay and repository atomic/outcome behavior. Reuse the accepted-effect and transaction patterns without changing append-only import semantics. Implement the three-way truth table and preconditions as pure functions before UI.

Validate lineage, issuance provenance, target incarnation, schema/size bounds, allowed fields, and referenced identities. Show conflicts, already-satisfied proposals, unsupported suggestions, explicit clears, and no-proposal distinctly. The owner chooses the accepted subset; all accepted effects commit together or none do. Protect intervening unrelated edits and invalidate only relevant changes.

Test renamed and duplicate-named records, divergent Save As files, deleted/recreated relations, replay, Undo/reapply, failed final writes, altered manifests, scope escape, and validation failure after earlier operations. Keep report receipts historical and bounded. Use explicit owner review for topology suggestions outside the initial correction schema.

**Exit:** a second team corrects a description/provider/support assignment, including an intervening local conflict, without name-based mislinking, duplicate records, unintended clearing, or partial success. Do not add generic dataset merging.

### AP-W09: Bounded upkeep

Review AP-D6. Read inventory selection/paging, organization/category/reference behavior, aggregate write API, and relevant scenario validations. Add batch provider/category/support assignment only. Show the frozen selection across pages and an exact before/after preview; preserve support notes unless their change is explicitly included.

Validate accepted changes before commit. A refusal names the blocked record and makes no partial changes. Explicitly deselect/re-preview to continue. One history step restores every affected field/reference with positions untouched. Separate assigning an organization from renaming its shared record.

Classify structural issues, assessment gaps, and duplicate suggestions clearly. Reuse existing data-issue and related-record navigation rather than another repair console. Candidate duplicate detection does not include automatic merge.

**Exit:** a routine ownership/support change across an inventory is faster but no less understandable or reversible than individual editing.

### AP-W10: Integrated usability and operating envelope

Run the complete acceptance subset for the intended release, not just each author's isolated tests. Exercise the frozen synthetic assessment from an empty file through interview, review, correction, export, save/reopen, and handoff. Re-run uncoached users after fixes; do not guide them to the intended controls.

Measure declared fixtures and environments. Capture actual output at desktop, laptop, narrow windows, browser zoom, keyboard-only, and print size. Inspect dense results, warnings, blank/unknown states, modal cancellation, and controls after dynamic changes. Test old-file migration and any new field/table across Save/recovery/Undo and capture classification.

Use a separate integration/reviewer pass on final bytes; author evidence is not independent review. Keep software pass, blocked-native, blocked-participant, and accepted risk distinct. No feature is considered accessible merely because its markup has ARIA attributes.

**Exit:** evidence-backed operating limits, supported workflows, remaining risks, and owner decision. No invented sample participants, certified accessibility claim, or support envelope inferred from file size.

### AP-W11: Exact-candidate delivery

Run the prescribed full gate and retain the actual HTML, SHA-256, source/tree/build identities, logs, and scope-specific evidence. Retrieve the CI candidate, verify those identities, and reopen those same bytes offline in supported installed browsers. Revalidate native/file/recovery and representative output cases when their owning code changed.

Update user help and migration/review-format compatibility notes only for shipped capabilities. Keep main preview and versioned release clear. Prepare release notes and a support-information path without leaking assessment contents. A new migration requires warnings about older-build compatibility and backup instructions.

**Exit:** a reviewable candidate with exact receiving evidence and explicit owner merge/release decision. This package does not publish automatically.

## 4. Shared implementation contracts

### Ownership and separation

One integrator owns schema/identity, source snapshots, draft semantics, output scope, and classification. Parallel authors can implement pure analytical selectors, report rendering, fixtures, and user documentation after these contracts are integrated. Do not let separate agents invent competing record IDs, review states, route interpretation, or context restoration.

A schema/contract PR should be small and paired with tests and a first consuming feature. Runtime data must be read and written through explicit typed repository methods. UI code never writes SQL directly. Continue the present strict TypeScript, DOM construction, and offline policy.

### State and effect contracts

- **Named view**. States/events: Unsaved definition -> Save; stored -> Restore; stale -> Repair/Cancel; Side-effect boundary: Restore is view-only. Save/rename/delete is one repository command.
- **Evidence**. States/events: Needs review -> Review; relevant assertion changes -> Needs review; conflict -> Disputed; Side-effect boundary: Preserve source/reviewed value. No topology write or blanket service verification.
- **Question**. States/events: Open -> Resolve; resolved -> Reopen; missing target -> Detached; Side-effect boundary: Explicit resolution; preserve history and former identity. No fake service/network creation.
- **Report**. States/events: Choose scope -> Freeze -> Render -> Download requested / Failed / Cancelled; Side-effect boundary: Frozen content and name remain owned by source session. No implicit save or data mutation.
- **Review exchange**. States/events: Draft scope -> Durable issuance -> Export prepared -> Returned -> Reviewed -> Applied; Side-effect boundary: Do not equate export with delivery. Only accepted current effects write.
- **Reconciliation**. States/events: Parsed -> Validated -> Prepared -> Conflict / Commit / Refusal; Side-effect boundary: Verify relevant base inside one transaction; roll back SQL and history together.
- **Batch**. States/events: Select -> Preview -> Commit / Refusal / Cancel; Side-effect boundary: Frozen explicit selection; no partial or hidden-target updates.
- **Analysis**. States/events: Choose scope/question -> Derive -> Inspect/Focus -> Back; Side-effect boundary: No writes, positions, file-dirty state, or history.

### What must not regress

Maintain qualification for unfinished child/connection/route work, exact warning payloads, pending versus saved inspection, stale-session navigation, manual arrangements, scenario/As-Is separation, no-CDS uncertainty, marking/caveat framing, truthful native versus download status, and optional recovery. These are baseline obligations, not features to redesign again.

## 5. Governance changes to propose, not fabricate

Preserve ADR-0001 and ADR-0002. Reconcile document wording through its owner rather than treating a historical status label as permission to switch stack or downgrade files. Promote the six AP-D decisions through the installed workflow before dependent implementation.

The existing append-only import policy remains valid for its existing operation. Reviewed corrections are an additive separately specified workflow. Old non-goals about saved views/exports/evidence describe prior scope; supersede only those scope boundaries accepted for this increment. Do not rewrite historical test reports, approvals, or receipts.

If an accepted native spec becomes canonical, leave this directory a clear pointer and provenance record. Do not allow agents to independently update both versions.

## 6. Progress and handoff record

All packages currently have **not started** implementation and **not run** acceptance. The proposal is not a progress ledger for work that has happened.

For each receiving package record:

- Receiving and final candidate commit/tree/HTML checksum; affected requirements and exact cases.
- Source/tests read, decisions made and their authority, migration/format identity, and changed paths.
- Commands, environment, exit codes, actual artifacts, observed failure-before-fix where applicable, and reviewer scope.
- Separate implementation readiness, software checks, native/AT/participant evidence, accepted risks, and blockers.
- Next bounded action and rollback/recovery instructions. Preserve prior artifacts without treating old successes as current results.

Report scope reductions as explicit deferred requirements with rationale; do not close acceptance by deleting difficult cases. Every new persistent field and interaction needs the corresponding output, keyboard, identity, migration, and loss-protection checks before its package closes.
