# Interaction checkpoint — PR25

This follows direct user feedback that button text looked odd, text clumped and Inventory navigation still felt laborious. Completing the earlier MR01–MR13 checklist did not establish a usable or visually accepted product.

The scoped implementation is SPEC-INTERACTION-POLISH / PLAN-INTERACTION-POLISH, atop `1586c58`. It remains on `codex/sim-usability-redesign`, PR25.

- Populated datasets open Services; empty datasets open Networks. Network scope filters exact identities. Service name, network, provider and marking have distinct desktop columns and readable narrow cards.
- Each record type retains its query, page, scope and scroll. Selection preserves focus and position. Find reveals an excluded typed service; Back restores the prior context. Replacing the dataset clears browsing caches. Browsing never creates an Undo step.
- Plain actions center labels consistently; menus, record links, reference fields and picker choices align intentionally left. Action groups and summary chevrons have coherent spacing. Long labels are checked for overlap and horizontal overflow.
- Empty staged relationships show a concise empty state without unused search, zero-range counts or dead paging. Populated collections retain complete search and bounded paging. Creation guidance names Add; existing records name Apply; both explain Save file. The consumer field is labelled Consuming organization, distinct from the Add consumer action.

## Verification and limitations

The current source passed `npm run check`: strict typecheck, lint, format check, standalone build, 388 unit tests and 442 browser checks in installed Chrome and Edge. Actual browser zoom at 200% and 400% passed. Numeric line/branch coverage remains unmeasured under the declared no-tooling exemption.

Inventory and editor behaviors first failed against the prior build. Existing centering geometry checks passed on that build and are characterized honestly, not represented as RED. Independent product review exposed a new sticky-toolbar keyboard obstruction. A genuine failing reverse-Tab/hit-testing regression demonstrated it at 1366px and 320px; removing stickiness made both hosts pass. The cross-scope Find→Back coverage gap was also closed. Both independent follow-up reviews and their triage/verdict funnel passed with no remaining findings.

The first full run had 434 passing browser checks and two 200% zoom timeouts. The complete corrected run passed 442 checks without timeout or assertion changes. `LOCAL-CHECK.log` and `SOURCE-SHA256.json` bind the final evidence; navigation RED/GREEN logs are retained beside them. Before/after PNGs remain local visual artifacts, also copied to `C:\Users\brenn\Downloads\SIM-PR25-Checkpoints\04-visual-review`; the manifest records their hashes and storage. Source code, offline dataset boundaries, classifications and atomic drafts remain covered by the full existing suite.

This is implementation and local qualification. It is not a human satisfaction result, release, merge authorization or hosted-CI result. Native DONE records indicate completed implementation, not user acceptance. ADR acceptance and build/version metadata were not included in this pass.

## Local checkpoint

Open `C:\Users\brenn\Downloads\SIM-PR25-Checkpoints\04-inventory-and-control-rhythm.html` directly in Chrome or Edge. It has the same bytes as the current built `dist/sim.html`; its SHA256 is in the manifest.

1. Open About and demo → Open demo. Inventory should start with Services. Scan the separate name/network/provider/marking columns and choose a network scope.
2. Search, move to a later page, select adjacent services, switch Show to another record type, then return. Check retained context and the effort of browsing.
3. Edit a service → Connections. Compare empty groups, populated groups and the reference picker. Check button labels, alignment and spacing.
4. Navigate by keyboard, including backward through rows. Try 200%/400% browser zoom. Report any friction or odd alignment; passing mechanics do not settle the visual judgment.

Checkpoints 01–03 and the participant kit named `1586c58` remain historical snapshots. Use checkpoint 04 for this iteration. No real-participant study was conducted or invitations sent.
