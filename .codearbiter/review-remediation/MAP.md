# Map remediation author handoff

Assigned findings MNT-04 and EXP-02 are implemented in the shared worktree, same branch/PR25. No build, commit, changelog or unrelated source was authored by this unit.

## Owned surface and implementation

| File | Symbols | Public signatures / consumers |
| --- | --- | --- |
| src/map/map-view.ts | Private exportView/exportVector; new private beginExport, prepareExport, finishExport; createMapView Find event handlers | createMapView and MapView/MapViewContext signatures unchanged; workspace callbacks unchanged. No new public seam. |
| e2e/map-find-dismissal.spec.ts | New fictional fixture and four browser regressions | Tests use existing public UI helpers and repository fixture APIs. |

MNT-04 shares busy/start and completion, source/name/marking capture, text measurement and frame preparation. PNG and SVG rendering remain separate. Each renderer retains its original resolveCapture await, followed by synchronous source/frame/renderer freezing. PNG still captures its blob promise before awaiting decoding and framing; SVG still freezes its scene synchronously. The refactor adds no await between source capture and renderer freeze. Existing render-zoom restoration, stale/cancel behavior, status messages and frozen captured filename remain intact.

EXP-02 treats the Find input and result container as one transient boundary. Outside pointer presses (captured before canvas handlers) and outside focus dismiss results without cancelling the action or moving its focus. Escape from either location dismisses; result Escape restores input focus, and Escape suppresses the browser's native query-clearing action. The query is retained. Refocusing input or pressing Down after dismissal reopens results. Existing result activation and Up/Down navigation remain usable. The app creates one map for its lifetime, consistent with the existing document-level menu controller; no new generic popup framework or public lifecycle was introduced.

## Evidence

- Pre-production baseline supplied and verified:388 unit tests and120 focused existing Edge/Chrome tests passed; baseline-unit.log and baseline-browser.log. The focused baseline includes direct export UI tests in map.spec.ts for PNG framing, export busy/synchronous render error, frozen PNG filename across dataset replacement, and SVG framing.
- EXP-02 regression-first run against unchanged dist SHA256 db500bf3cf94f7fc764300a652277e9a9a4b237bd31e127cc043e30474ab45e7: `npx playwright test e2e/map-find-dismissal.spec.ts --workers=4 --output=.../map-find-red-results`. Six failures for the intended defect (3 suggestions retained after Fit map, genuine outside canvas press, or Escape from a focused result, in both hosts); two existing internal-navigation/activation cases passed. Saved in map-find-red.log.
- Root subsequently rebuilt the integrated source. GREEN command: `npx playwright test e2e/map-find-dismissal.spec.ts e2e/map.spec.ts e2e/connected-navigation.spec.ts e2e/menu-dismissal.spec.ts --workers=4 --output=.../map-green-results`.
- GREEN:76 tests passed across Edge and Chrome in29.9s, including all eight new host cases, unchanged partial/disambiguated Find and dirty-navigation Stay/Apply tests, menu lifetimes, all existing map export safeguards. Saved in map-green.log and map-green-results. Tested dist SHA256 c3db55789f2ed2e7f1c97b82ac7a9a4fedf08982e028de5dbabb10c02bb67c77.
- `npx tsc --noEmit` passed after map implementation; `npx eslint src/map/map-view.ts e2e/map-find-dismissal.spec.ts` passed; scoped Prettier check passed.
- Existing test assertions were not modified or weakened. No public seam was introduced by the refactor.

Numeric coverage exemption: CTX-TECH-STACK#FACT-002 says, "No numeric coverage command or provider is configured in package.json or Vitest configuration. Unit checks use npm test and browser checks use npm run e2e. Lines and branches remain unmeasured; no numeric coverage pass is claimed." The same no-tooling profile and direct export UI oracles apply before and after.

Full npm run check, independent integration review, commit and exact-head hosted CI remain root-owned delivery obligations. These results do not claim human acceptance or merge/release authority.
