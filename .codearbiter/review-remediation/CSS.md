# MNT-03 CSS consolidation

Author owns only `src/ui/app.css`. Base: `6f51da52c1884fd91a0b64e4bd0e33175fa204a6`.

| Surface | Consumers | Parity contract |
| --- | --- | --- |
| `.workspace` base | `createWorkspace` DOM; `.has-selection`, `.editing`, collapsed-list and max-height modes | Preserve grid, flex, minimum size and background; preserve later mode/media priority. |
| `.entity-list button` base | Inventory record rows from `createListPanel` | Preserve effective grid, alignment, borders, color, sizing and wrapping. |
| `.entity-list button[aria-current="true"]` | Selected inventory row | Preserve later effective dark selection background, transparent border and accent inset. |

No exported method/signature or new public seam. Numeric coverage exemption: CTX-TECH-STACK FACT-002 states: "No numeric coverage command or provider is configured in package.json or Vitest configuration. Unit checks use npm test and browser checks use npm run e2e. Lines and branches remain unmeasured; no numeric coverage pass is claimed."

Before edits, `css-parity.cjs` captured30 actual style/geometry states in Chrome and Edge:1366,1024,768,390,320 CSS-pixel widths, each in inventory/selected/editing mode. `css-before.json` retains computed values for workspace, list, first row, selected row and editor. Existing preserved `e2e/interaction-layout.spec.ts` directly checks inventory row geometry, text alignment, no overflow and selection at those widths. Existing `e2e/usability-layout.spec.ts` covers320px and actual browser200/400percent zoom. Parent baseline388unit+120focusedbrowser passed before source changes.

Removed proven-shadowed declarations: old workspace260px/main/340px columns and duplicate grid rows; old inventory display:flex, align-items:flex-start and margin-bottom; earlier selected border/background. Removed flex-direction:column because grid rows do not consume it. Moved surviving workspace display:grid, flex:1 and min-height:0 into current base; moved surviving row width100%, transparent border/background and left text alignment into current grid base.

The redundant default `.workspace:has(.list-panel.collapsed)` selector was removed from the base grouping: the plain base supplies the same default columns/rows/background; explicit has-selection/editing grouped selectors remain. Keeping moved flex at plain `.workspace` specificity preserves the short-viewport `.workspace { flex:none }` override. No responsive/container/mode declaration changed.

Source formatting: `npx prettier src/ui/app.css --check` PASS. Production build and post-build parity remain root-owned. Rerun `node <TEMP>/css-parity.cjs <TEMP>/css-after.json` after root build; compare parsed JSON exact. Parent runs unchanged interaction-layout/usability-layout and full npm run check. No screenshots or native/device acceptance claimed by this source-only edit.

Post-integration result: root build passed, then the initial30-state comparison matched all geometry; two1366px selected states sampled different intermediate hover-transition colors. Probe was corrected to move the pointer away and await current animations before sampling. Original baseline was recaptured with this same corrected probe against checkpoint06, whose verified SHA256 db500bf3cf94f7fc764300a652277e9a9a4b237bd31e127cc043e30474ab45e7 matches the pre-edit artifact. Corrected baseline and integrated capture are exactly equal across all30 states and all captured properties/geometry. Evidence: `css-before-settled.json`, `css-after-settled.json`, `css-parity-settled-result.json` (parity:true, differences:[]). No production source changes were required by this probe correction.
