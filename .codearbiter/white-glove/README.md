# Post-PR26 white-glove verification

This follow-up implements the supplied bounded stabilization package. It does not authorize a merge or release. Native work items and PLAN-WHITE-GLOVE own implementation progress; the files here are point-in-time verification records.

The receiving source is merged PR26, `90d04afe422804b1922417cdc719dd7ff2e4dec8`, tree `4ac3883bbdb0c5b020cabde4a35f47c1ba107971`. The original checkout also had unrelated diagnostic and visual artifacts. Those were content-addressed before work and preserved. The original package is retained selectively in `input/`, with provenance in `input-manifest.json`; supplied probes were not executed.

## Behavior corrected

| Finding | Result and proving behavior |
| --- | --- |
| WG01 | The trailing About menu anchors within the desktop viewport. Narrow/short screens retain a bounded scrolling fallback. Tests measure visible menu bounds and keyboard access. |
| WG02 | Picker results scroll independently while search, count, paging and creation remain reachable. Very short dialogs retain whole-dialog scrolling. |
| WG03 | Current assignment has a visible text badge and a persistent qualified summary, separate from hover/focus. Search and blur never assign a record. |
| WG04 | An unfinished inline child participates in page-loss awareness. A real browser beforeunload event is tested after trusted input on a clean positioned dataset. Save refuses unfinished child work and reveals it; it never creates that child implicitly. |
| WG05 | Boundary focus offers no undefined expansion. Directed expansion stops at recorded closure, including the final cycle edge, and transfers focus to Fit focus when exhausted. Focus remains read-only. |
| WG06 | Empty record libraries, empty eligibility and searches without matches give different guidance. The first-service screen offers direct creation rather than futile reuse. |
| WG07 | Narrow relationship rows place secondary actions after qualified record information. Names and network identity remain intact. |
| WG08 | Contextual defaults establish the initial creation baseline. Untouched contextual Add cancels cleanly; meaningful edits and explicit copy intent retain existing safeguards. |
| WG09 | CI retains the exact checked HTML, SHA-256, source/tree/PR-head identity, check log and browser report. The retention helper rejects stale HTML, mismatched reports and dirty-source success claims. Artifact retrieval is a separate delivery check. |

Integrated UAT also found six defects. Long marking/caveat bands now wrap completely in both PNG and SVG. Capture feedback reserves its layout space, so the first capture cannot shrink the viewport. Focus fitting remeasures the canvas before fitting. Structural labels retain their font at two-times capture scale. Shared-record pickers re-read eligibility after child creation without rebuilding the parent draft. Data issues identify qualified records in ordinary language, retaining raw witnesses in optional Technical details.

Caption layout may widen a tall capture's outer canvas to keep annotations readable. The original map rectangle is centered without stretching or changing its scope. Dense whole-enterprise views convey topology; readable individual service detail requires a deliberately focused/zoomed view. Captures explicitly describe their current viewport and omitted foundational dependencies.

## Evidence and limits

`uat-results.json` and its readable companion account for all 180 original rows. Per-host browser observations, adapters, negative fixtures, exact readback and remaining obligations are distinct. `EXECUTION-STATUS.json`, `RESUME.md`, the source manifest and compact gate report identify their collection epoch. Historical REDs and fixture/probe corrections remain in `history/`; a later pass does not erase them.

All application tests load the built standalone file offline using installed Chrome and Edge. Entity changes and aggregate operations use downloaded SQLite readback, including Undo/Redo and stored positions. E2 exercises seven domains, 120 services, 40 organizations, two proposals and complete recorded routes. E3 exercises 1000 services, 60 organizations and a hub with more than 100 relationships. Actual downloaded SVGs are rendered; PNGs are decoded and inspected at presentation and print mockup sizes.

The suite includes isolated installed-browser startup at actual 200% and 400% browser zoom, with measured device pixel ratio, CSS viewport and non-pinch visual scale. This is browser automation evidence, not screen-reader or physical-device certification. Native File System Access permission dialogs, OS file-picker interactions, real recovery/conflict behavior and real human usability sessions remain separately unqualified on this candidate. A previously denied Windows UI route was not retried through another host. Adapter tests prove application ownership/error handling, not native OS acceptance. Earlier user-reported Chrome save acceptance concerned an earlier candidate and is not silently transferred to these bytes.

## Local testing

Use a fresh synthetic file or a disposable copy. Open the delivered checkpoint directly in Chrome or Edge. Check About against its supplied manifest before testing; a source merge does not update an already-open HTML file. Keep the original dataset untouched.

1. Open About and Help, then click another task. Menus should yield; dialog closure should return usable focus.
2. On a saved clean dataset, edit Orders, choose a missing provider, type only inside its inline child and attempt reload. Cancel the browser warning and verify the child text remains. Cancel the child explicitly, then cancel the untouched parent. Do not accept a destructive reload unless you intend to discard this synthetic text.
3. Create and use an organization from Support. Open Provided by and Consuming organization without discarding the parent. Find that exact organization, complete the aggregate, Apply once, then Undo and Redo. Readback should preserve every relationship and raw note.
4. At normal, 200% and 400% browser zoom, search/page a picker, reach Create new, cancel it and return to the trigger. At narrow width, read a long connection and use its actions without losing network identity.
5. Use network focus, a multi-hop chain and a cycle. Undefined expansion should be absent; exhausted expansion should explain closure and leave Fit focus usable. Return to the prior framing.
6. Capture PNG and SVG before and after status feedback appears. Inspect the same scope, complete top/bottom caveat, readable annotations and a focused detail. Reopen the downloaded dataset and verify that captures/focus did not alter stored positions.
7. For outstanding native acceptance, follow `participant-protocol.md` using temporary files. Record browser/version, exact HTML hash, operation, observed result and independent readback. Do not treat a missing permission prompt as a tested denial.

## Delivery boundary

This work prepares one follow-up PR. Hosted checks and downloaded artifact verification are reported by exact run/head identity when available. A retained CI artifact is a review candidate, expires according to workflow retention and is not a public release. G01-G07 capability proposals remain outside this stabilization work. Broad distribution still needs the owner’s release authorization and disposition of the mandatory environmental/human proof obligations.
