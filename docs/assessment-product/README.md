# SIM assessment product proposal

**Status:** Proposed for review. Documentation only; no capability described here is claimed to be implemented or accepted.

**Baseline:** `a2b84ef19f6e1ab880c032f79190aa9b434244f7` on `main`, including PR 30. Prepared November 17, 2026.

## Product outcome

Walk into an unfamiliar enterprise, establish what exists and how it connects, identify what still needs answers, and hand over a picture that another engineer can understand and maintain.

SIM remains a local, offline engineering tool. The next investment is completing the assessment lifecycle, not adding autodiscovery, an AI assistant, a server, accounts, or a new diagramming framework. Existing add, change, remove, inline creation, reuse, save, inspect, and capture workflows must become no harder.

## Read in this order

1. [Specification](spec.md): product requirements, interaction contracts, data semantics, safety boundaries, and exclusions.
2. [Implementation plan](plan.md): independently deliverable increments, dependencies, source entry points, review gates, and receiving-agent instructions.
3. [Acceptance protocol](acceptance.md): 60 individually identified checks, a fictional assessment fixture, real-participant protocol, and evidence rules. Every case starts **not run**.

This proposal captures the direction requested after the decision to defer autodiscovery. Requirement IDs `AP-01` through `AP-20` are local traceability IDs, not codeArbiter approval or work records.

## Value priorities and delivery order

Evidence and uncertainty have the highest domain value. They do not need to delay a useful release of the current tool. Deliver the work in bounded increments:

- **I0: Dependable current product**. Result: Reconcile outstanding acceptance, run an uncoached pilot, fix observed blockers, and qualify an identifiable release candidate. Boundary: No feature expansion or automatic release.
- **I1: Reusable assessment outputs**. Result: Assessment scope, stable exchange identity, saved viewpoints, inventory export, read-only assessment reports, and derived decision views. Boundary: Uses existing recorded information; does not invent evidence or completeness.
- **I2a: Trustworthy assessment**. Result: Optional assertion-level evidence, uncertainty, unresolved observations/questions, and enriched reports. Boundary: No mandatory metadata for ordinary entry and no ticketing system.
- **I2b: Human validation and maintenance**. Result: Scoped owner-review packs, explicit correction reconciliation, and narrowly bounded batch edits. Boundary: One editing owner with multiple reviewers; no shared-file concurrent editing.

Each accepted increment must be useful alone. Implementation dependencies are not permission to combine all increments into one large feature PR. Human/native evidence blocks the corresponding release claim; it does not prevent isolated preparation and software testing for later increments.

## Non-negotiable user direction

- Creating a missing network, organization, application, or category must remain possible in context without discarding or reconstructing the unfinished parent task.
- Keep shared-record creation distinct from applying a service and from saving a file. Keep the existing independent-child Undo policy visible.
- Reuse existing shared identities. Creating a similar service creates an independent service, not a move or an alias of the source.
- Prefer readable summaries, qualified identities, bounded searchable collections, and contextual actions over more permanently visible buttons.
- Add optional assessment capability without requiring a setup wizard, evidence form, named view, or owner-review process to draw or capture the first map.
- Preserve offline operation, classification/caveat disclosure, explicit file ownership, and the repository write boundary.

## Source baseline

The specification is based on the named files below, not on treating previous audit findings as still open. Check their receiving versions before implementation.

- **[AGENTS.md](../../AGENTS.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md)**. Offline single HTML, repository-only writes, full check gate, fictional fixtures, branch/PR workflow, immutable merged migrations.
- **[Domain types](../../src/domain/types.ts)**. Existing service/network/organization/dependency model; no first-class assessment evidence, question, saved-view, or review-exchange types.
- **[Import engine](../../src/import/engine.ts)**. Existing append-only import has preview/effect comparison and atomic acceptance; existing records are not updated.
- **[Map view](../../src/map/map-view.ts)**. Explicit in-session view/filter/focus/framing state; existing capture and navigation boundaries.
- **[User guide](../user-guide.md)**. Current inline creation, service aggregate, Create similar service, recovery, file conflicts, and capture semantics to preserve.
- **[README](../../README.md)**. Main preview and separately versioned releases are distinct delivery channels.
- **[ADR-0001](../../.codearbiter/decisions/0001-single-file-offline-html-stack.md) and [decision log](../../.codearbiter/decisions/decision-log.md)**. Preserve the chosen offline stack. The ADR body and historical lifecycle wording differ; this PR does not rewrite their status.
- **[ADR-0002](../../.codearbiter/decisions/0002-forward-only-migrations.md)**. Upgrade older files in memory; persist only on Save; newer schemas are refused by older builds.
- **[PR 30 acceptance record](../../.codearbiter/pr29-residuals/acceptance.md) and [PR 30](https://github.com/SUaDtL/SIM/pull/30)**. Software, retained-artifact, native, assistive-technology, and participant evidence have different scopes. Reconcile dated delivery addenda rather than copying a historical verdict.

## Governance and authority

These Markdown files are a reviewable design proposal outside the generated `.codearbiter` artifact store. They do not modify an accepted ADR, native spec, plan, lifecycle, work status, or waiver. A receiving implementation agent must read the current governance records and use the installed codeArbiter workflow to promote accepted scope into its native artifacts. Preserve these requirement and acceptance IDs in that mapping; do not maintain two competing normative specifications.

Opening or merging this documentation PR is not proof of production acceptance, native-file behavior, real-user usability, or authorization to publish a release. Product/schema decisions in this proposal remain reviewable until accepted through the normal project process. Implementation and release are separate actions.
