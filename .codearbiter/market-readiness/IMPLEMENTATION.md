# Market-readiness remediation

User scope: implement SIM-MR-02 through SIM-MR-13 and the SIM-MR-01 distribution-notice blocker on `codex/sim-usability-redesign`, PR25. The original checkpoint remains a historical review of source4516994; this record describes its remediation. Canonical criteria/progress live in SPEC-MARKET-READINESS, PLAN-MARKET-READINESS and the thirteen native work identities, not in this evidence index.

## Behavior and proving checks

| Finding | Result | Proving surface |
| --- | --- | --- |
| MR01 | Full project and installed runtime-closure license/attribution texts embedded in the one offline HTML; generic traversal fails closed on absent/empty/unqualified runtime licenses. | runtime-notices unit tests, build-output artifact tests, file-size browser license-dialog test |
| MR02 | Bundled Help explains purpose, a first map, terminology, applied/saved state and recovery; draft and focus survive. | market-workspace browser Help test |
| MR03 | Visible accessible direction, no-CDS and unverified-connectivity legend. | market-map browser legend test |
| MR04 | Bounded complete diagnostic pages; full preview/completed receipt download; latest completed receipt retained in the originating session; source/classification/caveats and spreadsheet-safe cells. | import-receipt unit and browser tests, existing import regressions |
| MR05 | Visible omission/scope counts and focus/filter disclosure retained as semantic capture lines. | market-map and unchanged connected-focus browser assertions |
| MR06 | Detached captures retain the recorded-dependencies / connectivity-not-verified qualification. | market-map SVG and existing PNG/SVG tests |
| MR07 | Bounded display-only curves avoid demonstrated unrelated-node, CDS and network-heading intersections without moving nodes or changing endpoints. | route-offset unit tests, actual browser geometry and retained export inspection |
| MR08 | Projected service counts distinguish outgoing dependencies, incoming Used by services and consuming organizations. | market-workspace projection test |
| MR09 | New dataset names use the shared host detector and exact acknowledgement before candidate creation; rejection retains the active draft. | market-workspace cancellation and confirmed-name saved-byte readback tests |
| MR10 | Metadata size checked before native/fallback Open and every related baseline read/copy; parser bound retained. | dataset-file-size unit tests and file-size browser tests |
| MR11 | PNG graph-content assertion rejects a blank dark map while retaining captions and classification bands. | map PNG test and retained old-oracle negative control |
| MR12 | Qualified record identity stays visible on all editor tabs, including copy source and explicit destination. | market-workspace tabs/copy/destination test |
| MR13 | Shared PNG/SVG annotation geometry accounts for viewport height, wrapping and bands at a 1280×720 reference fit. | export unit tests, market-map SVG geometry and actual Chrome/Edge fitted renders |

## Observed verification

The current full `npm run check` passed: typecheck, lint, formatting, single-file build, **32 unit files / 388 unit tests**, and **398 Chrome/Edge browser tests** including existing 200%/400% zoom, layout, import, save/recovery, projection and frozen-capture contracts. Raw transcript retained as LOCAL-CHECK.log; executable input and artifact hashes are in SOURCE-SHA256.json.

Regression-first evidence was observed before repairs for file-size twins, missing notices, missing Help/identity, dataset-name acknowledgement, projected counts, truncated import diagnostics, receipt classification, visible map semantics, route crossings and presentation fit. The old PNG nonwhite-pixel predicate failed the preserved blank-render negative control; the new semantic graph predicate passes it and real captures.

Failed attempts were retained and corrected: first full run stopped on map-test formatting after a temporary negative control restored line endings; an editor-copy test initially missed the existing collapsed More service actions disclosure; a later full run caught four unchanged SVG filter-caption assertions after deduplication joined scope into a wrapping paragraph. Semantic capture entries now retain each qualifier once, and those original assertions pass. No tests or thresholds were removed to obtain GREEN.

Independent security, coverage and distribution review uses the read-only triage/verdict funnel. Source findings, unit accounting and final result are retained separately from the engineering gate. No numeric coverage tooling is configured; lines/branches remain unmeasured.

## Actual export inspection and limits

Fresh isolated Chrome156.0.8078.80 and Edge157.0.4341.46 captures were inspected in the UI, actual PNG and actual rendered SVG fitted to 1280×720. The demonstrated route clears unrelated nodes and the network heading; captions appear once, full-dataset markings remain intact, Saved remains unchanged, and no page errors or nonlocal requests were observed. The final annotation fit measured approximately11.99px legend text,12.70px context,21.17px title and13.13px band text. Binary screenshots stay local; source hashes and observations are retained as text.

The curve search is bounded and does not guarantee a complete obstacle-free route for every arrangement. The display target is not a human readability, projector, print or accessibility certification. Real participant sessions, assistive-technology speech/task qualification and exact-candidate native-dialog/physical-recovery qualification remain separate. The user's earlier successful Chrome native save/readback checks are retained as historical evidence. No merge or release publication is authorized by this record.

## Local testing checkpoints

Snapshots are local at `C:/Users/brenn/Downloads/SIM-PR25-Checkpoints/`:

1. `01-file-and-workspace.html`: open About and demo → Licenses and notices; inspect project/runtime terms and close. Open Help while a draft is pending. Try New with `synthetic.example.invalid` and reject the warning; the draft must remain.
2. `02-reconciliation-and-editing.html`: edit a service across Details, Connections and Support, then create a similar service through More service actions and choose its destination. Import `fixtures/mixed-networks.csv`, visit all rejection pages, download the preview receipt, import the valid row, and reopen Import CSV → Last import receipt. Cancel a corrected preview and verify the completed receipt remains.
3. `03-map-and-capture.html`: use the latest candidate for the complete behavior. Open demo, select a service, ask Depends on / Used by / Network connections, inspect the legend/scope and toggle foundational links. Capture PNG and SVG; inspect current-viewport scope, certainty, intact highest marking and annotation readability at the intended display size.

The third checkpoint and current `dist/sim.html` contain all thirteen changes. Earlier snapshots are intermediate test stages and are not release candidates. All use synthetic data. Continue normal Save/Open/Save As testing with temporary files as appropriate; no real customer inventories are needed.
