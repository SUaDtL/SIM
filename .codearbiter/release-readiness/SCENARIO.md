# R11/R12 scenario readiness implementation

Status: DONE scoped implementation and focused integration. All42hostcases passed on root build3; full project qualification, review, exact-head CI and release remain separate.

Receiving source main55986ee2; baseline HTML18b1d4a09ff1b6f62eee0985f276525a48f23d8916d884d1dd0f8d794bb8288e.

The three named regressions ran against the unchanged baseline distributed HTML in Edge and Chrome. All six failed for the precise intended defects: two responsible scenario changes yielded one diagnostic action; a fresh builder selected merge instead of no operation; a100-change scenario rendered100rows rather than20. Evidence: scenario-red.log and scenario-red-results. These observations do not imply all acceptance journeys were run.

R11 now retains changeId across scenario diagnostic targets and deduplicates by exact change identity. Human-readable Review labels use describeChange. Naming-conflict diagnostics also identify authored changes involving baseline services. Wording explains remove and re-add instead of advertising a nonexistent revise action. ScenarioChangeBuilder.revealChange chooses the exact row page and focuses it without changing builder or metadata. Root owns typed EntityTarget wiring and a read-only exact-change related dialog; the test requires independent pending metadata remain retained.

R12 now begins with no operation/source/target/network selected. Required choices are explicitly validated and focused. The builder reuses the common20-result searchable picker for source service, merge target (including planned services), network and provider. Backing select IDs/options remain for data identity; controls are hidden as in existing reference fields. Change rows reuse collectionPage with20items, search, count and previous/next controls, bounded focus, no-match/empty and prerequisite guidance. Immediate Add/Remove, staged intent, exact sensitive acknowledgement and Undo contracts are retained. Initial duplicate option-population code was removed; refresh is the only option-population owner.

Owned format and ESLint pass. No own build, global format, native artifact mutation, old-test edits, commit or push performed. Root must adapt legacy setup actions that assumed implicit network/source choices or visible native selects while preserving their outcome assertions. New tests exercise both exact diagnostic targets, no arbitrary merge choices,500services/100changes, duplicate qualified names, bounded browsing and actual saved-byte readback.

Remaining: coordinated root build, exact-change modal integration and full focused GREEN; complete project checks/review/delivery separately. No physical/native picker or human acceptance claimed.


## Integrated progress
Root build1 SHA9ab238d9e90e358701ea30ef6002213f5b2f8dcdeb5d76e27290df4cbfeca674: all6newhostcases passed. Additional R12completion regression was then observed RED in bothhosts: successful Add under an excluding change search still showed only the previous Service099row. The repair captures returned change identity and invokes existing revealChange after clearing consumed intent, clearing the search to visibly reveal/focus the new row. Independent metadata is retained. Evidence scenario-completion-red.log/results.

Root build2 SHA7ca4aa1b351fd7ca5e71733f39a73f552eb50e47c110a3db9c30c8b7b2fc7d70: all6newhostcases passed, including the completion extension. Exact commands: npx playwright test e2e/readiness-scenario.spec.ts --workers=1 --output=<uniqueTEMPpath>, exit0, scenario-green2.log/results. Owned ESLint and Prettier checks passed.

A broader run of scenario.spec.ts, scenario-builder.spec.ts and connected-projection.spec.ts then produced32pass/4fail across36hostcases, exit1, scenario-regression2.log/results. Two failures were the old exact Portal heading assertion after the structured-summary change; two revealed a genuine integration defect: collectPendingIntent validation throws before the editor's builder-phase catch, so an invalid proposal was labeled as a scenario metadata Name error while change-message stayed empty. Reported to root/editor owner for correction with unchanged invalid-builder preservation/no-write assertions. These failures remain unresolved at this report point; new6/6does not certify the broader run.

Coordinated R18copy: ordinary command hint now explains immediate Add/Remove plus Undo and unapplied Cancel/Discard beside the scenario controls. The long editor heading belongs to editor author. No new source edits after build2.


Additional R11 positive follow-through was exercised in the same three test definitions: after excluding a change with row search, the exact diagnostic opens the targeted modal and Review in scenario editor reveals/focuses the exact authored row, clears the excluding query and retains independent metadata without an unnecessary draft prompt. Expanded6/6Chrome/EdgeGREEN on unchanged rootbuild2: scenario-green2-expanded.log/results, exit0. No app source changed for this expansion. Final owned source hashes: scenario-current-source.json.


## Terminal verification — DONE
On root stablebuild3 SHA73a2bb7b3701f7d5a3be0c44395a7bc4b5e885b3db30b18d8acd15fe5c59f61d, command `npx playwright test e2e/readiness-scenario.spec.ts e2e/scenario.spec.ts e2e/scenario-builder.spec.ts e2e/connected-projection.spec.ts --workers=1 --output=<uniqueTEMPpath>` exited0:42/42Chrome/Edgehostcases PASS in35.5seconds. Evidence scenario-green3.log and scenario-green3-results. This includes the owned6newhostcases and36retained scenario/projection cases; do not add overlapping earlier runs as distinct checks. The former builder-validation routing failure is repaired by editor owner, and old projected headings/setup interactions were adapted by root while retaining semantic assertions. No failures remain in this scoped run. Owned source/tests were unchanged after rootbuild2 and throughout build3verification. No own build, existing-test edits, native mutation, commit or external write performed. No native-file or human acceptance claimed.
