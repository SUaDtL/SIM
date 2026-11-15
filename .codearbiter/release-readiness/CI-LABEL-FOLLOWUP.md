# Low-zoom map label correction

The first hosted CI run on commit `3cfbbd4c9a1160d26bafc58416bf0293454fcb01`
failed its existing Chrome layout check: network label size was 10.961160381810211 px
against the retained 11 px baseline. The other 725 browser cases passed.
Run: https://github.com/SUaDtL/SIM/actions/runs/43759754812

`applyZoom()` capped network and CDS font growth at twice their model-space size.
On sufficiently wide maps that contradicted the existing intended screen-space
minima of 13 px and 11 px. Removing that cap preserves those minima at low zoom.
Service-label hiding, export scale handling and stored node positions are unchanged.
This is a general zoom-size correction, independent of the demo layout's random seed.
It does not introduce a new layout algorithm or remove the V03 crossing limitation.

## Regression and checks

The new offline full-app regression fixes zoom at 0.25 and 0.125, checks actual
Cytoscape font size times zoom for both kinds of structure label, and verifies
stored service/CDS placements are unchanged. On the broken built app it failed
with network 10 px / CDS 8 px at zoom 0.25, versus expected 13 / 11. The original
layout thresholds and hover-label assertions were preserved.

An initial placement assertion included compound-network centers, which Cytoscape
derives from child/label bounds. That overbroad assertion was corrected to the
actual stored leaf placements. The final test was rerun RED against the capped
production build before the same repair was restored. `CI-LABEL-RED.log` retains
that qualified RED; the earlier setup/correction logs remain in local TEMP evidence.

Full `npm run check` exited 0: typecheck, lint, format, build, **393 unit tests and
728 Chrome/Edge browser tests**, including the new regression in both hosts and
existing layout, capture and 200%/400% zoom checks. A later test-comment-only
correction also passed the final format check. `CI-LABEL-CHECK.log` records the
full run; `CI-LABEL-SOURCE.json` binds its source, with that comment correction.
Numeric coverage remains unmeasured: `CTX-TECH-STACK#FACT-002` states that no numeric
coverage command/provider is configured for this TypeScript application.

Independent delta review uses a coverage producer, finding triage and aggregate;
the separate `CI-LABEL-REVIEW.md`, `CI-LABEL-TRIAGE.md` and `CI-LABEL-COVERAGE.md`
retain its final observed result. Earlier coverage/safety review remains evidence
for the unchanged stabilization scope. The PR records subsequent exact-head hosted
CI; no old run is substituted for the new head.

Native work: `WORK-F7CDF6801227387ACE6D9F1689BF1CB8`, locally complete. This completion
does not certify hosted CI, publication, native file UI or participant acceptance.
R05 remains open; G01/G02 remain scoped and queued. No merge or release is performed.
