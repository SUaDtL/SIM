# SIM usability redesign

Source: SIM-Usability-Review-and-Prototype-2026-11-13.zip. Receiving baseline: `1cfa5c1df7519361b10136724a37959659923a9f` (merged PR24). Branch: `codex/sim-usability-redesign`. The prototype is an interaction reference; all implementation and qualification below use the real offline application and repository.

| Review | Implemented behavior | Principal proof |
| --- | --- | --- |
| U01 | File/About disclosure, visible Save/Undo/Redo/document and recovery states; retry only on failure | usability-shell, dataset-file, recovery, banner, import |
| U02 | Distinct Map workspace, contextual questions, Filters count, Fit vs Layout, direct Capture and SVG option | usability-shell, connected-focus, map, scenario/projection |
| U03 | Common bounded exact-ID picker, inline Create and use, retained parent, child Undo, stale-owner refusal, keyboard return | usability-picker, reference-picker-component, connected-editor |
| U04 | Committed relationships in read summaries; staged relationships only in edit | usability-records, connected-navigation |
| U05 | Qualified identity, route caption and compact Actions; incoming edits belong to consumer | usability-layout, connected-editor-acceptance |
| U06 | 800px task editor with header/tabs, one scroll body and separate footer | usability-layout |
| U07 | Existing records read first, explicit Edit/F2, direct Add | usability, usability-records |
| U08 | Shared readable field presenter for inspection and peek, named references/booleans/missing states | record-summary unit tests, usability-records |
| U09 | Inventory30, picker20, relationships20, Find30 bounded pages with query/count/context | list-panel/collection unit tests, usability-picker/records/layout |
| U10 | Inventory/Map navigation, retained parked draft and return paths, narrow single task | usability, usability-layout |
| U11 | Create similar / Start from existing, explicit destination, new ID and optional support copy | usability-records |
| U12 | One aggregate draft across Details/Connections/Support, precise hidden-section errors, atomic Apply/Undo | acceptance-journeys, connected-editor-acceptance, usability-layout |

## Action locations

| Previously supported operation | Current location / return |
| --- | --- |
| New, Open, Save As | File menu; Save file remains direct |
| CSV import/templates/preview | File > Import CSV; existing import dialog |
| Banner caveat | File > Banner caveat |
| Choose/Stop recovery | File; separate recovery status remains visible |
| Retry recovery | Visible beside status after failure |
| SQLite version / fictional demo | About and demo |
| Add/edit/delete all baseline types | Inventory Show/Add; read summary Edit/secondary Delete; editing More edit actions |
| Missing references | Choose field > Create; Cancel/Back returns within picker |
| Inspect shared reference | View reference / relationship identity; Close returns; Edit uses dirty-work guard |
| Create similar | Service summary secondary actions; also Start from existing within Add |
| Support/consumers/outgoing/incoming | Service summary tabs; Edit tabs; per-row Actions for draft route/remove/incoming-owner edit |
| Scenario changes | Inventory Scenarios > Edit; existing scenario builder |
| Projected service inspection / Edit As-Is | Map To-Be/Compare inspection, explicit baseline transition |
| Map Find / filter | Map discovery results and Filters disclosure |
| Full-chain highlight | Selected map subject > Highlight chain / Clear highlight |
| Direct/network focus | Selected subject questions, Expand/Back only during focus |
| Fit / Re-layout | Direct Fit; Layout > Re-layout, retaining confirmation/Undo |
| PNG / SVG | Direct Capture; Capture options > Export SVG |
| Undo/Redo | Visible toolbar and existing keyboard shortcuts |
| Return from full editor / parked draft | Inventory/Map parks it; Return to draft; read inspection Return to results |
| Back | Restores typed target, surface, list/map/editor context; distinct from Undo |

## Copy and state boundaries

Create similar copies descriptive fields, explicit classification/foundational values and existing provider/application/category references. Destination must be chosen. Support assignments/notes copy only with the explicit checkbox. Consumer organizations, all dependency directions, source coordinates, history, scenario and recovery state are excluded. Creation uses existing atomic repository commands; no schema or dependency changes.

Browser persistence, network APIs and HTML-string DOM construction remain prohibited. Native file persistence and recovery continue through the existing session/repository paths. No fixture contains customer data. Automated file-access tests use picker/file-handle stubs; successful user Chrome native-save testing was reported for the earlier merged increment, not repeated or claimed as new candidate-native proof.

## Usability evidence limits

The user reviewed the first production service checkpoint and reported "No blocker; continue". Automated journeys and visual inspection establish the stated observable behavior, not that unfamiliar representative users finish uncoached. No comparative task timings, hesitation/wrong-turn study, screen-reader certification or general WCAG conformance claim is made. Those observations require actual participants. The machine-readable tracker separates automated evidence from this outstanding human evaluation.
