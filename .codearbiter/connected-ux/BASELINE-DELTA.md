# Connected UX receiving baseline

Same branch codex/sim-f26-recovery, same PR24, as explicitly directed by the user.

Reviewed pin: a8a330c66f4b075dedc6e40c17fb122359a77fe3; receiving commit: a70d59843cf295d9405d7570b7221112d9d82666. F26 remains unmerged and is retained in this branch. Initial only untracked state was a local derived work view; it is preserved.

The final F26 full check passed on Windows: 316 unit and 194 Edge/Chrome tests. This proves the receiving baseline, not later Connected UX acceptance.

| Path | Receiving delta against packet pin |
| --- | --- |
| src/ui/editor-panel.ts | same blob |
| src/ui/forms.ts | same blob |
| src/ui/workspace.ts | same blob |
| src/ui/list-panel.ts | same blob |
| src/domain/repository.ts | same blob |
| src/map/graph.ts | same blob |
| src/map/map-view.ts | same blob |
| src/map/style.ts | same blob |
| src/ui/app.css | same blob |
| src/main.ts | changed by F26 |

The relevant editor/map/repository blobs matched the review pin at entry. Historical probes are retained as historical supporting evidence and were not relabeled as current tests. Current regression tests and implementation changes are recorded separately. No new dependency, migration, network access or browser persistence is planned.
