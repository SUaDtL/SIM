# MNT-02 implementation report

Status: locally implemented; root owns final built-browser qualification, full checks, commit and PR25 delivery. No build or commit performed by this author.

## Refactor surface and parity contract

| File | Symbol/public signature | Consumers | Proof |
| --- | --- | --- | --- |
| src/ui/relations.ts | `RelatedEntity` gains optional readonly `dependency: Dependency`; `relatedEntities(snapshot, target, options?)` gains optional missing-reference and dependency-detail presentation controls. Existing two-argument discovery still omits stale targets. | `recordSummaryModel`, existing direct relations tests. | Original direct tests preserved; metadata/options seam tests RED first, then GREEN. |
| src/ui/record-summary.ts | `recordSummaryModel(snapshot, target)` signature unchanged; private dependency row/group construction. | `createRecordSummary`; existing direct summary model tests. | Original assertions preserved; passing missing-reference characterization before edits; before/after full-model parity. |

Baseline direct command: `npm test -- src/ui/relations.test.ts src/ui/record-summary.test.ts`: 13/13 PASS (`projection-baseline.log`). Additional summary characterization passed on pre-edit code (`projection-characterization.log`).

Coverage tooling exemption: CTX-TECH-STACK FACT-002 says: "No numeric coverage command or provider is configured in package.json or Vitest configuration. Unit checks use npm test and browser checks use npm run e2e. Lines and branches remain unmeasured; no numeric coverage pass is claimed." Direct tests exercise both touched public functions. No numerical coverage result is claimed.

## Implementation

The relationship projection now retains exact dependency metadata, including both endpoint IDs and the route. Dependency deduplication includes endpoint IDs, preventing equally named provider rows from collapsing. The active summary consumes these projected rows directly; its separate network/CDS dependency selection and reconstruction block is removed. One generic non-service group pass retains roles, stable dependency keys and connection actions. The service projection is now used in production for incoming/outgoing dependencies and organizational consumption instead of remaining a test-only branch.

The summary deliberately retains missing service references as non-navigable text, while default discovery continues to omit them. A small optional dependency-detail formatter preserves each presenter's established wording without computing and discarding a discovery rendering. This was necessary: a before/after comparator detected existing `Missing network` versus `Missing network #ID`, and `Missing cds` versus `Missing CDS`, conventions. The corrected version preserves the original full summary output in those cases. No new exported function, class or projection framework was introduced.

## Verification

- `projection-seam-red.log`: 2 named RED tests for exact endpoint metadata and opt-in retained unavailable targets; existing assertions remained green.
- `projection-detail-seam-red.log`: separate RED test before implementing the optional formatter contract.
- `projection-green.log`: final direct tests 17/17 PASS. Original 13 assertions/tests unchanged; four tests appended.
- `projection-full-parity.log`: 6/6 before/after fixture cases PASS. Each case compares the complete summary model for all seven entity types against HEAD source: normal, missing provider, missing network, missing CDS, missing organizations, and equal-name distinct provider endpoints. TEMP helper `check-projection-parity.py` materializes read-only HEAD reference modules with import bindings; no production files or assertions are replaced.
- Final scoped ESLint PASS (`projection-lint.log`), global TypeScript PASS (`projection-typecheck.log`), and scoped `git diff --check` PASS.

Only the four assigned source/test paths changed. Test fixtures remain synthetic UNCLASSIFIED. No dependencies, repository writes, schema, runtime IO, builds, commits or governance mutations were performed by this author. Browser/full-suite/hosted-CI status remains root-owned and is not inferred from unit parity.
