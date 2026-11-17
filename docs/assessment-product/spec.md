# Specification: a reusable, trustworthy enterprise assessment

**Status:** Proposed. **Baseline:** `a2b84ef19f6e1ab880c032f79190aa9b434244f7`. **Scope:** Documentation only in this PR.

This is the behavior contract for the [assessment product proposal](README.md). The [plan](plan.md) owns sequencing; the [acceptance protocol](acceptance.md) owns test methods and evidence. No new features, migrations, approvals, or completed acceptance are asserted by this document.

## 1. Users, job, and scope

The primary user is a solutions engineer entering an unfamiliar enterprise. They need to record imperfect information during conversations, understand service and network relationships, obtain corrections from the people responsible, brief a recipient, and leave a maintainable assessment behind.

Supporting users are an inventory curator, an architecture planner, a contributing reviewer, a keyboard/assistive-technology user, and a briefing recipient. These are task perspectives, not new account types or permission systems.

The product loop is **record -> inspect -> question -> validate -> correct -> communicate -> maintain**. It is not a discovery platform, CMDB replacement, ticketing system, project scheduler, collaborative database, or verified network-reachability tool.

The five value areas are evidence/questions, saved views/handoff, human correction, efficient upkeep, and derived decision views. Dependable operation and real-user acceptance are their foundation.

## 2. Core behavior and presentation

### AP-01: Preserve the usable core

The existing local-only single HTML, explicit `.sqlite` files, repository-only mutation, atomic service aggregates, Undo/Redo, meaningful saved checkpoints, draft protection, and session-owned asynchronous completion remain invariants.

No server, runtime network request, account, telemetry, remote font, browser-persistent dataset store, dedicated IP/FQDN field, or framework rewrite is introduced. New free text receives the existing sensitive-input checks and exact-payload confirmation policy. A warning or banner is not a guarantee of safe handling or a declassification mechanism.

Inline **Create and use** must retain the parent fields, relationships, deliberate default overrides, active section, scroll, and return focus. Creating the shared child remains its own explicit commit and Undo step; cancelling the parent does not delete it. Meaningful child-only input remains protected from page loss. Search, viewing, and cancellation must not create records.

Create similar service retains its independent-draft semantics, explicit destination, source classification review, reused shared references, optional support copy, and excluded dependency/consumer/position copy. This increment does not add a template library.

A user can still add the first network/service and capture a clean map without completing assessment metadata, evidence, review, or view-naming tasks.

### AP-02: Quiet, comprehensible interactions

Extend the established read-first summaries, wider aggregate editor, stable action footer, qualified searchable pickers, and bounded collections. Do not add one always-visible button per new requirement. Evidence/questions belong in a contextual section; decision views belong in the existing inventory/map navigation; reports and review exchange belong with file/output operations.

A task surface has one primary action with clear scope. New nested work must join the existing pending-work boundary or be explicitly resolved before Apply, Save, navigation, or capture. Reuse the current exact-payload and session ownership behavior rather than adding another dirty-state mechanism.

Preserve keyboard position, cancellation, status announcements, current-assignment indicators, section scroll, and viewport return. Errors in a hidden section reveal that section. Do not require mouse dragging or rely on color, hover, tooltip text, or an overflow menu as the only way to understand a critical state.

Use one canonical relationship representation per context. A summary shows committed state; an editor shows its draft with a pending indicator; a projected inspector identifies its scenario. Never inspect a different state without labeling the distinction.

## 3. Assessment context and trust

### AP-03: Name the assessment and define its scope

Reuse the existing dataset name rather than creating a second competing title. Add optional assessment description, scope, exclusions, responsible assessor/team label, and assessment period/as-of date. A report has a separate generation timestamp and source checkpoint. An assessor-entered date is not proof that every assertion was verified on that date.

An empty scope renders as **Scope not recorded**, not a claim that the entire enterprise is represented. Editing assessment metadata follows normal validation, Undo, dirty-state, Save, recovery, and classification behavior. It does not change topology or node positions.

### AP-04: Assertion-level evidence, not a global verified badge

Evidence attaches to a specific recorded assertion: a service field, responsibility role, dependency presence/route, organizational consumption, or an explicit assessment of a relationship set. It can also be assessment-level before a target is known. Target identities are stable and typed; labels alone do not bind evidence.

A minimal record contains a source label and inert locator/note, evidence basis, optional checked-on date and assessor label, review state, target/aspect, and the target value or relevant fingerprint reviewed. Basis and review state are independent:

- Basis: **reported**, **configuration**, **observed**, **inferred**, or **unspecified**.
- Review state: **needs review**, **reviewed**, or **disputed**.

Reviewed means the assessor reviewed the stated assertion and basis; it does not mean operational reachability or every field on the service is verified. Date, source, and reviewed value remain visible. Multiple sources may disagree; adding a new source never silently overwrites the previous one.

A relevant field/route change retains the older evidence but marks its applicability as **needs review**. Unrelated changes, such as a category edit or viewport movement, do not invalidate an ownership assertion. Material edits to an evidence record's source/basis also require renewed review. Creation/copy/import never auto-awards reviewed status.

Evidence locators are inert text, not automatically fetched URLs or opened files. Do not embed raw customer documents, execute their contents, store credentials, or introduce an attachment subsystem. Source excerpts and filenames can themselves be sensitive and are included in classification/export review.

### AP-05: Preserve unknown, absence, and incomplete coverage

An empty provider, support tier, or dependency set means **not recorded**, unless a person explicitly records a scoped absence finding. Separate **not assessed**, **reported/present**, **confirmed absent for the stated scope/date**, and **not applicable**. Do not turn these into mandatory global service statuses or derive them from blanks.

A confirmed-absence assertion identifies what was assessed and when. Adding a conflicting provider/link makes that assertion outdated/needs review; it must not block ordinary corrective entry or continue to display as current confirmation.

Completeness summaries name their denominator and scope: for example, **19 of 84 recorded services have ownership questions**. They do not claim the percentage of the unknown enterprise discovered or calculate a generic readiness score. Missing optional metadata is a review opportunity, not automatically a red structural error.

### AP-06: Capture unresolved observations and questions

Allow a question before a service/network is sufficiently known to create a valid domain record. Example: **A reporting capability was described; hosting network unknown. Ask Platform.** No fabricated `TBD` topology is needed.

A question contains text, optional linked records/relationship, optional responsible organization/team label, optional next action, state, and a resolution note when resolved. The initial states are **open** and **resolved**; reopen preserves the prior resolution. Due dates, approvals, priorities, and ticket-system integration are excluded initially.

Linking an observation to a newly understood service does not imply resolving its question or verifying a fact. Resolve explicitly and retain the reason/source. Deleting a referenced target discloses the effect and preserves the question/evidence as an assessment-level entry with its former qualified identity, rather than silently deleting assessment knowledge. Undo restores links and state. Deleting the annotation itself is a separate deliberate operation.

Questions and evidence stay out of the normal topology until linked to actual records. Use restrained indicators and a searchable review list, not a new badge on every map node by default.

## 4. Reusable views and communication

### AP-07: Persist named viewpoints, not accidental historical snapshots

Save a name, optional caption/question, current scenario/projection identity, filters, directional focus and depth, foundational-link visibility, and framing. Preserve typed selected identities where useful. Do not persist DOM handles, transient navigation history, pending drafts, or recursively captured focus-return history.

Initial viewpoints refer to current saved inventory positions; they do not introduce per-view layout copies. Opening a view never moves nodes, mutates topology, adds a data Undo step, or marks the file dirty. Saving/renaming/deleting a view is a normal repository change and is undoable/file-persisted.

A viewpoint is live over the current dataset, not a dated baseline. A dated report freezes the content it exported. An immutable internal assessment-snapshot/history engine is deferred.

Before restoring a view, validate its scenario and target identities. Missing references produce an explicit repairable state with **Restore available scope**, **Edit view**, or **Cancel**, as applicable. Never silently replace a missing scenario with As-Is, drop constraints to expose all records, or present an empty map as successful restoration. Repairing the saved definition requires an explicit save. Browser/viewport size changes may clamp framing to usable bounds without altering positions; disclose materially different framing.

### AP-08: Export a useful read-only assessment

Provide **Export assessment** without requiring a named view. Keep existing direct PNG/SVG capture. Initial assessment output is self-contained, read-only HTML with print styling, plus structured inventory export; a PDF engine is not required.

The report includes assessment name/scope/exclusions, generation time and source checkpoint, application/data-format identity, selected views with captions/legends and omission disclosures, qualified service/responsibility/dependency tables, and a statement of what is not represented. In I1, evidence/questions sections are omitted or explicitly unavailable, never synthesized. I2a adds included evidence/questions and their actual state.

Freeze one coherent source snapshot and export selection before rendering. Capture/report tables, labels, marking, caveat, source name, and checkpoint must refer to the same snapshot even if the live dataset changes. Failure after an explicit Apply does not roll it back or claim it never happened. A long export has bounded progress, cancellation where supported, and a recoverable error with no false success.

Draft handling extends the existing **Export current recorded state / Apply and export / Cancel** contract. No current-state export silently includes unapplied text. A report generated from unsaved applied content is labeled accordingly; viewing/exporting alone never saves or mutates the dataset.

Recipient comprehension is a release criterion, not merely valid HTML. Report text explains recorded dependency direction, scenario status, unverified connectivity, omitted scope, and open questions without internal variable names. Provide print and desktop inspection with dense qualified names and realistic relationship counts.

### AP-09: Export inventory before adding update import

Export qualified tables for existing entity and relationship types with stable IDs and a versioned manifest defining scope, row counts, generated time, schema/build identity, and classification/caveat. Network-qualified names aid reading; identity does not depend on names.

CSV exports and JSON interchange serve different purposes. Human-facing CSV cells receive spreadsheet formula neutralization. Lossless typed interchange retains exact values and explicit nulls without ambiguous escaping. Define a reversible, versioned encoding before promising CSV round-trip editing. A display CSV with added protective characters must not later overwrite literal source values accidentally.

Exports are bounded and local. Quoting, Unicode, multiline descriptions, commas, empty strings, nulls, large inputs, duplicate names on different networks, and formula-leading text are tested. Ordinary exports are not correction authorization or backups of unapplied drafts.

### AP-10: Scope and classification apply to every output

One explicit export scope controls tables, images, notes, questions, hidden JSON, accessibility text, metadata, filenames, and review manifests. Output must contain no out-of-scope data through hidden serialization, full-dataset attachments, tooltip text, or relationship expansion. Necessary boundary endpoints are included as explicitly disclosed context, with only the selected permitted fields. Unrelated record details are excluded.

Filtered output retains at least the full source dataset/projection marking and caveat. Higher-marked included annotation or incoming review material raises the handling floor. Hiding records never automatically lowers marking. Export is not sanitization or declassification. Warnings acknowledge limitations in recognizing sensitive text.

New notes/questions/evidence need a reviewed classification design before their migration lands: each carries an explicit marking defaulted conservatively from its target/current dataset; unattached assessment-level items use the current document floor. Dataset marking includes these persisted items, even when they are off-screen, and the legacy-data default must not lower existing marking. No arbitrary automatic caveat rewriting.

Render imported/exported text safely using established DOM/escaping boundaries. Read-only reports make no runtime network requests, contain no executable user content, and do not resolve external evidence automatically. Validate counts, sizes, strings, and nesting before materializing review files; treat exports returned by reviewers as untrusted input.

## 5. Human review and corrections

### AP-11: Durable identity and review provenance

Introduce a dataset lineage UUID and stable exchange identities for entities and addressable relationships through new forward migrations; do not change existing numeric internal IDs or infer identity from names, paths, IPs, or row order. A route change retains its dependency identity but changes the relevant assertion fingerprint. Deleting and recreating a relation receives a new incarnation; stale evidence must not silently attach to it.

Save As preserves assessment lineage, and New creates a new lineage. Create similar service creates a new entity identity. Diverged Save As copies remain the same lineage but are not assumed to be identical; correction acceptance requires the issuing review/base identities and per-field comparisons. A generalized file-merge or independent assessment-fork command is out of scope.

Generated identities must participate in normal persistence. Before issuing an actionable review pack for newly assigned identities, require a durable saved base or provide a clear **Save base and issue review** action. Plain read-only exports may use an unsaved labeled checkpoint. A cancelled picker must not claim issuance. The authoritative scoped issuance record/base must itself be persisted before reporting a correction-capable pack as ready; the exact sequence and failure recovery are reviewed in AP-D1/AP-D3.

A cryptographic digest binds the issued package to the scoped before-values and selected fields retained locally; it is integrity evidence, not proof of reviewer identity or agreement. A returned file cannot redefine its own trusted base. Missing issuance provenance leads to an explicit manual comparison path, never automatic acceptance.

### AP-12: One editor, multiple reviewers

An organization's **Prepare review** uses its explicit provider, support-tier, consumer, and related dependency roles. Keep those roles separate. Preview exact records and boundary context before export; do not send the whole enterprise by default.

Use portable readable tables/questions and a versioned correction format, initially typed JSON or a documented review CSV plus integrity-bound manifest. No account, email integration, cloud upload, or simultaneous shared-file editing is required.

Reviewers propose corrections. They do not directly mutate the source dataset, automatically verify evidence, or become authenticated merely because a name is in a file. The assessment owner explicitly accepts/rejects/defers differences. Review receipts identify the asserted reviewer/source label and method without claiming verified identity.

The first correction scope is bounded to existing service descriptions, provider/category/application references, support assignments/notes, and evidence/question responses. New services, topology/route changes, classification changes, bulk network moves, and arbitrary deletion are not accepted as unattended review operations. Preserve such suggestions as visible questions or route them to the existing explicit editor. Scope expansion needs a separate reviewed contract.

### AP-13: Three-way, field-level reconciliation

For an issued review compare **B: issued base**, **C: current SIM**, and **R: returned proposal**, per exact identity and field. Distinguish omitted/no proposal, explicit set, and explicit clear. An omitted row or blank cell does not authorize deletion or clearing.

- **No proposal, or R equals B**. Proposed behavior: Keep C; do not undo a later local edit.
- **C equals B and R differs**. Proposed behavior: Offer the returned change for acceptance.
- **C equals R**. Proposed behavior: Already satisfied; do not write or duplicate history.
- **C differs from B and R, and R differs from B**. Proposed behavior: Show an explicit field conflict; retain C until resolved.
- **Missing/changed identity, out-of-scope field, deleted target, or absent issuance**. Proposed behavior: Quarantine the proposal with a reason; do not recreate or match by name.

Changes to allowed fields that depend on a referenced organization/application/category also validate the reference's current identity and existence. Existing baseline data may contain admitted legacy issues; unrelated accepted corrections must preserve them rather than silently normalize or block all work.

Preview records the exact accepted effects and relevant preconditions. Before commit, re-evaluate those preconditions within the transaction. A relevant change invalidates the plan and returns to review; an unrelated drag or unrelated record edit does not cause needless rejection. All explicitly accepted changes commit as one repository transaction, one Undo step, and one coherent refresh. Unexpected failure rolls back SQL and in-memory history together. Invalid proposals remain visible and are excluded only by explicit decision, not silently skipped during commit.

A repeat of the same accepted return is idempotent. Undo followed by reapplication needs explicit renewed review, not an irreversible consumed flag. Retain a concise session-local, downloadable outcome receipt with scope, proposed/applied/skipped/conflicted fields, and source checkpoint. Like the existing import receipt, it can remain visible after Undo but clears on dataset replacement/restart; the UI explains that boundary. The saved issuance base is durable. This increment does not introduce an immutable decision log or durable partially reviewed queue. Historical receipts are not a live assertion that their changes remain present after Undo or later edits.

Existing CSV import stays append-only and unchanged by default. Add **Apply reviewed corrections** as a distinct operation with distinct help. Do not relabel the old importer as an update mechanism.

## 6. Efficient maintenance and decision views

### AP-14: Safe, bounded batch upkeep

First batch operations assign an existing provider, category, or support organization/tier to explicitly selected services. Provider assignment and renaming the shared organization are different operations. Support notes remain unchanged unless an explicit separately reviewed action changes them. Provide the same inline reference creation without conflating the shared child commit with the later batch.

Show scope across pages, selected count, exclusions, before/after values, and dependent effects. Select-all never silently includes hidden search results. Capture a stable target set and relevant base values; changed membership/preconditions requires review. No-op records do not create changes.

Validate the whole accepted set before commit. One invalid selected operation refuses the batch with navigable reasons; allow explicit deselection and a new preview. No partial-success batch masquerades as complete. Apply one atomic Undo step and preserve existing node positions, scenario independence, and unrelated fields. Network moves, marking changes, bulk deletes, and copied routes are excluded from the initial batch release.

### AP-15: Explain issues without inventing failures

Keep structural diagnostics (invalid references/routes) separate from assessment questions (unrecorded ownership) and optional metadata. Reuse the current data-issue navigation; do not rebuild a second diagnostics platform.

Potential-duplicate detection is a review suggestion only, initially for shared organizations/applications. Show why items were flagged and their actual usage. Equal service names on different networks are not duplicates by default. No automatic merge, deletion, or re-parenting. Duplicate merging is deferred until an explicit consequence/identity-preservation contract exists.

### AP-16: Network dependency matrix

Derive rows as consuming networks and columns as providing networks. Each cell counts logical recorded service dependencies once, not CDS drawing segments. Drill down to exact qualified connections and then focus the map with a usable Back path.

Separate local, boundary-with-CDS, and no-CDS-recorded relationships. Invalid/unresolved scenario routes remain visibly unresolved. A zero cell means **zero recorded dependencies in this scope**, not proven isolation. Respect the active baseline/proposed/compare context; compare has explicit before/after counts rather than mixing ghost and current edges. Expose filtered/omitted coverage.

### AP-17: Responsibility and dependency-impact views

The responsibility view keeps provider, Tier 1/2/3 support, and explicit consuming organization roles distinct. Missing assignments read as **not recorded**. Search, export, drill-down, and Back use the same typed identity and scope as the rest of SIM.

The impact view shows recorded direct and transitive dependency paths in the chosen direction. Traversal is bounded and cycle-safe. Sharing a provider or CDS does not pull unrelated consumers into an upstream dependency question. Explain a result with at least one path; do not enumerate every cyclic/combinatorial path. Indicate truncation and provide controlled expansion when limits apply.

Use **Has a recorded dependency path to** rather than **Will fail if**. No outage, business criticality, redundancy, reachability, or mission-survival inference is warranted by the present model. Counts decreasing in a scenario are not automatically improvement. Optional purpose/impact text can use existing descriptions/evidence; a new scoring or business-capability ontology is not required here.

Derived views do not modify inventory, positions, Undo, or saved checkpoints. They share the same search/selection and output scope contracts rather than adding isolated navigation state.

## 7. Storage, compatibility, and acceptance

### AP-18: Extend data without replacing the application

The proposed supporting records are assessment metadata, saved viewpoints, assertion evidence, questions, stable exchange identity, and scoped review issuance bases. Outcome receipts are session-local and downloadable unless separately approved for persistence. Design their exact tables and indexes during schema review; only ship each family with a usable consuming feature, tests, and help. No generalized event store, orphan unused schema, or attachment warehouse.

Use new forward migrations only. Opening an old file upgrades in memory and leaves disk unchanged until explicit Save. Existing absent metadata maps to unspecified/not assessed, never reviewed or confirmed absent. Updated schema admission, semantic diagnostics, integer checks, backup/recovery, Undo triggers, snapshot/serializer coverage, and logical checkpoint calculation include every new persisted record.

Do not assume `Snapshot` already includes assessment metadata or that map-only snapshots cover every new table. Add explicit typed read models where appropriate. Map/decision views consume domain data; evidence/review data need not enter the rendering graph.

Evidence retention on deletion, stale target handling, lineage issuance, and partial legacy repair need reviewed tests before migration acceptance. Old builds may refuse new saved schemas under ADR-0002; communicate that fact. Back up before upgrading; rollback means using an untouched original/copy, not editing migrations or inventing downgrade support.

### AP-19: Honest qualification and a measured operating envelope

Separate code-level, component/browser, downloaded-artifact, native-file/recovery, assistive-technology, and real-participant evidence. A passing automated gate or synthetic focus group never closes a native or real-human case. Historical accepted evidence cannot silently transfer to new bytes.

Use a modest uncoached pilot before broadening scope: initially three solutions engineers/curators spanning product familiarity, plus two briefing recipients. This is a proposed small-sample qualitative protocol, not statistical validation. They use synthetic imperfect information, may use in-app help, and receive no instruction about which buttons to click. Capture wrong turns, lost facts, misleading inference, and handoff comprehension. Record actual participants/results only after participation; no fabricated quotes or satisfaction scores.

Measure a declared hardware/browser/file-delivery environment using fixtures of approximately 100/500/2,000 services, 7/15/25 networks, and 300/2,500/10,000 dependencies with long names, cycles, duplicate names across networks, and sparse metadata. These are test targets, not advertised support. Bound or paginate collections and potentially expensive traversal; retain cancellation and visible status for longer work. Record cold/warm timing and p50/p95, peak memory, capture usability, and degraded behavior. Set publishable limits from measurements; the 100 MB admission cap is not a performance promise.

### AP-20: Identifiable delivery and separate release authority

A candidate includes the exact standalone HTML, checksum, application commit/tree/build identity, data-format identity, release notes, and evidence index. Verify and reopen the retrieved bytes in the supported offline browsers. Main preview and versioned release remain distinct. Do not claim binary equality from a version string alone.

Native Save, Save As, cancellation/refusal, optional recovery readback, external-writer conflict, and reload/close handling are exercised against those bytes in the supported environment. Test available keyboard/actual zoom paths and separately observe a real screen reader. Treat unavailable cases as blocked with a method-specific reason, not passed through stubs.

Core release blockers include silent loss of intended work, incorrect identity linking, saved/pending state misrepresentation, out-of-scope disclosure, or misleading output. Schema/output changes must requalify affected workflows. Any accepted risk is an explicit owner disposition and is never converted to a passing test. Merge/release authority is not inferred from this proposal.

## 8. Decisions for implementation review

The following defaults make the proposal executable without pretending exact schema/encoding choices are already approved. Resolve and record each in the normal governance workflow before its dependent work.

- **AP-D1**. Proposed default: Stable lineage/entity/relation identities; Save As preserves lineage; durable scoped issuance base. Review trigger: Before first identity/export migration.
- **AP-D2**. Proposed default: Conservative annotation marking, full-source output floor, explicit scope closure. Review trigger: Before notes/questions storage or assessment export.
- **AP-D3**. Proposed default: Typed correction package with trusted local issuance base and explicit set/clear/unchanged; CSV is separately specified. Review trigger: Before owner-review issuance and update acceptance.
- **AP-D4**. Proposed default: Current-layout named view definitions only; live view versus frozen report distinction. Review trigger: Before saved-view migration.
- **AP-D5**. Proposed default: Bounded per-assertion review state and retained orphaned assessment knowledge. Review trigger: Before evidence/question migration.
- **AP-D6**. Proposed default: Low-risk batches only; atomic accepted set; no automatic duplicate merge. Review trigger: Before batch implementation.

No architectural default here supersedes ADR-0001/0002. Any conflict is documented and routed through their owning process. Never hand-edit generated codeArbiter artifacts or lifecycle evidence to manufacture acceptance.

## 9. Explicitly deferred

Autodiscovery/collectors, AI-assisted inference, cloud sync, accounts, live collaboration, multiwriter SQLite, general file merging, ticketing/scheduling, arbitrary attachments, broad service-template libraries, automatic duplicate merging, universal health/readiness scoring, a new business-capability ontology, immutable internal historical snapshots, per-view layout storage, scenario-only network/CDS authoring, and a wholesale UI/framework rewrite are outside this plan.

A dated exported report and a manual saved copy remain available without promising an audit-grade historical baseline. Future features require a demonstrated user journey and separate scope approval, not merely another visible control.
