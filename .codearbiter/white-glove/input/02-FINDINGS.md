# Findings and correction contracts

Priority orders work; evidence level limits the claim. Each item remains open until the receiving candidate supplies the required proof.

## WG01: About menu extends outside the desktop viewport
**P1 | Major usability defect | browser layout reproduction**

At 1366 x 768, the 320-pixel About menu begins at x=1189.80 and ends at x=1509.80, 143.80 pixels past the right edge. The document expands to 1510 pixels. The same right-edge overflow occurred at 1024 and 1600 pixels.

Impact: Support information and right-hand portions of actions are clipped unless the user discovers horizontal page scrolling. It looks unfinished in a routine desktop task.
Method: Exact current CSS and menu controller with a source-matched main header DOM. Synthetic support information; not the running main.ts application.
Integrated status: Reproduce in built application before closure

### Reproduce
1. Open the exact candidate at 1366 x 768 or 1600 x 1000.
2. Open About and demo at the right of the document toolbar.
3. Check every edge of the popover, its actions, and document scroll width. Repeat with browser zoom and long build/browser strings.

### Required correction
Use viewport-aware placement for floating menus. Right-align the trailing About menu or use an appropriate anchored/popover placement with fallbacks and a bounded scroll body. Preserve menu dismissal and native file activation. Do not globally move every menu to an arbitrary fixed coordinate.

### Acceptance
- Every open menu and action fits the viewport or an intentional bounded scroll container.
- Opening a menu does not introduce horizontal document scrolling.
- Keyboard focus remains visible; Escape returns to the invoker; choosing an action executes once.

### Source and evidence
- [src/ui/app.css](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/app.css): File/menu positioning rules near lines 650-695 and responsive rules near 1750
- [src/main.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/main.ts): boot(): trailing About and demo details element
- [src/ui/menu-dismissal.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/menu-dismissal.ts): installMenuDismissal
- `evidence/component-results.json#measurements.about_widths`
- `evidence/screenshots/about-menu-1366.png`

## WG02: Populated pickers bury creation, count, and paging while search scrolls away
**P1 | Major usability friction | browser component reproduction**

With 25 organizations, the initial 20-result page has a 1660-pixel scroll height inside a 704-pixel dialog. Create new organization starts at y=1629.30 in a 768-pixel viewport. At the bottom, search is at y=-845 and Close picker at y=-901. The count and pagination are also below the initial visible results.

Impact: The user must scroll away from search to discover inline creation and then scroll back to change a search. The mandatory Create and use workflow exists but is unnecessarily hard to discover when the enterprise grows.
Method: Unchanged reference-picker.ts and dom.ts, exact current app.css, real Chromium interactions, synthetic option provider.
Integrated status: Current picker behavior executed; app journey still open

### Reproduce
1. Use a provider or support picker with at least 25 records.
2. Inspect its first viewport without using browser automation to scroll an off-screen button into view.
3. Scroll to Create new, then try to refine the search or close with the pointer.

### Required correction
Give the picker a stable heading/search area, a bounded independently scrolling result list, and stable count/paging/create actions. Keep creation secondary but visible when supported. Do not show Create for unsupported entity types. Preserve exact identity, cancellation, one-level child forms, and parent draft state.

### Acceptance
- Search, Close, result count, and supported Create remain reachable without scrolling through every result.
- The result list, not the whole dialog, owns routine browsing scroll.
- Keyboard paging and focus do not jump to unrelated controls; all matches remain reachable.
- At small heights, retain usable focus/reflow rather than consuming all space with fixed chrome.

### Source and evidence
- [src/ui/reference-picker.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/reference-picker.ts): searchBody, pagination, create, dialog.append
- [src/ui/app.css](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/app.css): dialog and picker-results rules
- `evidence/component-results.json#measurements.picker_initial`
- `evidence/component-results.json#measurements.picker_scrolled`
- `evidence/screenshots/picker-current-state-1366.png`
- `evidence/screenshots/picker-create-at-bottom-1366.png`

## WG03: The currently assigned picker option has no visible selected treatment
**P2 | Moderate usability defect | browser component reproduction**

Option 2 has aria-current=true, but its foreground, background, border, weight, shadow, outline and decoration are identical to the adjacent unselected option. No checkmark or Current assignment text is rendered.

Impact: A user reviewing an existing shared asset cannot visually identify the current assignment. Reuse becomes repeated searching and re-confirmation.
Method: Computed-style comparison plus screenshot of the actual picker component; not an assistive-technology certification.
Integrated status: Current component executed

### Reproduce
1. Open a picker whose selectedValue corresponds to a visible record.
2. Compare the current row with adjacent rows before moving focus or the pointer.
3. Repeat when the current assignment is on a later result page and when the query hides it.

### Required correction
Add a visible, non-color-only Current assignment indicator and a restrained selection treatment. Keep current assignment, keyboard focus, and hover distinct. A compact current-assignment summary can remain visible when search/page results exclude it.

### Acceptance
- The existing assignment is recognizable without relying on color alone.
- Screen-reader selected/current semantics remain truthful.
- Typing or highlighting never commits a replacement. Clearing remains explicit.

### Source and evidence
- [src/ui/reference-picker.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/reference-picker.ts): render(): aria-current attribute and row contents
- [src/ui/app.css](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/app.css): picker-option styling has no current-assignment state
- `evidence/component-results.json#measurements.picker_initial`
- `evidence/screenshots/picker-current-state-1366.png`

## WG04: Child-only creation input is outside the page-loss guard
**P1 | High-risk gap; not a claimed native data-loss reproduction | source trace plus extracted-predicate execution**

hasPendingDraft checks parent scalars, service aggregates, relationIntent, routeIntents and scenario intent, but not active child creation values. Child-form input only invalidates confirmation. Workspace delegates its pending predicate to the editor, and beforeunload checks that predicate plus committed unsaved work. In a controlled clean-parent state, child-only input leaves the predicate false.

Impact: After saving a dataset, a user can edit only a new organization/network inside a picker while the outer loss guard still considers the session clean. A browser reload/close may lose that unfinished input without the intended warning.
Method: Current editor, workspace and main source traced; unchanged hasPendingDraft excerpt executed with controlled state. No full-app native unload was executed.
Integrated status: Native reload/close reproduction REQUIRED

### Reproduce
1. Open a saved, clean synthetic dataset and edit an existing service without modifying it.
2. Open its provider picker, enter child creation, and type a new organization name. Do not Create and use.
3. Verify the parent and saved dataset remain unchanged.
4. Reload or close the browser with an actual user activation and observe the beforeunload behavior. Dismiss any loss prompt and verify child text remains.

### Required correction
Include meaningful child creation work in the session loss guard through an explicit picker/child draft contract. Do not automatically create or persist the shared record from a generic Save. Explicit child Cancel/Back must remain deliberate cancellation, and closing the parent/session must resolve the child. Never persist drafts to browser storage as a shortcut.

### Acceptance
- A meaningful child-only edit participates in browser loss protection.
- A clean untouched picker does not produce spurious warnings.
- Explicit child cancellation writes nothing and clears only that child intent.
- Completed Create and use remains its own shared-record commit and Undo step.

### Source and evidence
- [src/ui/editor-panel.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/editor-panel.ts): hasPendingDraft and referenceControls child input listener
- [src/ui/workspace.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/workspace.ts): returned hasPendingDraft delegate
- [src/main.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/main.ts): hasUnsavedEdits and beforeunload handler
- `evidence/draft-predicate-results.json`

## WG05: Expand focus is offered for a network view whose depth is ignored
**P2 | Moderate functional UX defect | pure production module execution plus UI source trace**

focusGraph produces identical network-connections results at depths 1, 2 and 100. The UI renders Expand focus whenever any focus exists; its handler increments depth, applies the view and fits again. The network-connections branch never reads depth.

Impact: A solutions engineer can repeatedly click an enabled expansion action that cannot expand the question. Reframing can look like work occurred even though membership did not change.
Method: Exact current focus.ts executed on a synthetic logical graph. Current map-view.ts handler and visibility branches read. No Cytoscape render executed.
Integrated status: Confirm visible control in candidate

### Reproduce
1. Select a network with boundary dependencies and enter Network connections.
2. Record the visible logical dependencies. Click Expand focus.
3. Observe membership and the control state. Repeat on a service focus that has reached the end of its directed chain.

### Required correction
Hide or disable expansion for network-connections under the current semantics. For directed service focus, make closure exhaustion understandable. Do not invent a new traversal interpretation merely to make the existing button do something.

### Acceptance
- No enabled Expand action is offered where expansion is undefined.
- Depends on and Used by continue to follow the correct direction and logical dependencies.
- A shared CDS or provider never pulls in unrelated consumers accidentally.
- Fit/focus remain view-only and never change saved positions or data history.

### Source and evidence
- [src/map/focus.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/map/focus.ts): network-connections branch versus directed depth traversal
- [src/map/map-view.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/map/map-view.ts): focusActions creation near lines 450-480; focusActions.hidden near 724
- `evidence/focus-results.json#observations.networkExpansion`

## WG06: Empty reuse pickers still suggest a search that cannot succeed
**P2 | Moderate onboarding friction | component execution plus caller source trace**

An empty required picker without creation says No matching records. Try another name. The New service editor always inserts Start from an existing service, even when listServices() is empty. The source-service picker has no creation operation.

Impact: A first-time user is sent into a dead end and told to keep searching an empty library. This is distinct from the earlier fixed instruction that falsely offered creation.
Method: Zero-record picker executed; Start from an existing service caller read in current editor source.
Integrated status: Verify first-service journey in candidate

### Reproduce
1. Start the first service in a completely empty dataset.
2. Choose Start from an existing service.
3. Observe that no query can yield a source service. Also inspect all-used/none-eligible relationship pickers.

### Required correction
Distinguish empty library, zero eligible records, and no query matches. Suppress or explain unavailable reuse actions. Use caller-specific guidance such as No services recorded yet; create your first service normally. Keep inline Create only where it is actually supported.

### Acceptance
- Every empty state offers an achievable next step.
- Search advice is used for no-match searches, not an empty option universe.
- Existing-asset reuse remains prominent when a reusable record exists.

### Source and evidence
- [src/ui/editor-panel.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/editor-panel.ts): New service: unconditional Start from an existing service action near 1035
- [src/ui/reference-picker.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/reference-picker.ts): render(): discovered.total===0 guidance
- `evidence/component-results.json#C01`

## WG07: Narrow connection rows give the action more space than the relationship
**P2 | Moderate readability issue; not a claimed WCAG failure | browser component visual observation**

At 320 CSS pixels, a 271-pixel connection row allocates 152.53 pixels to Connection details and 108.47 pixels to the identity/detail column. A normal long enterprise service name and route description require a row about 189.95 pixels high.

Impact: Relationship information becomes a narrow stack of words while the secondary action dominates the row. Scanning dense enterprise connectivity is slow and visually unbalanced.
Method: Actual relationship-collection component and current CSS, inside the production summary wrapper class with synthetic long names. Not the complete record-summary application.
Integrated status: Repeat in full inspector at real zoom

### Reproduce
1. Inspect a service with 20 or more long qualified connection names.
2. Use a narrow viewport or actual browser zoom that produces a narrow inspector.
3. Read identities, networks and routes without horizontally panning; compare content width to action width.

### Required correction
At narrow container widths, stack secondary actions beneath relationship information or use a compact contextual affordance with a clear accessible name. Preserve readable typography and network qualification. Do not solve this by shrinking text or dropping identity context.

### Acceptance
- Identity and route information get the primary reading width.
- Long names remain readable, not an artificial single-word column.
- Keyboard actions remain discoverable and reachable without hover.
- No horizontal content loss is introduced.

### Source and evidence
- [src/ui/relationship-collection.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/relationship-collection.ts): relationship-detail and relationship-actions row structure
- [src/ui/app.css](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/app.css): relationship-row two-column rule
- `evidence/component-results.json#measurements.narrow_collection`
- `evidence/screenshots/relationship-density-320.png`

## WG08: Contextual network defaults are counted as user edits before typing
**P2 | Moderate workflow inconsistency | source trace plus extracted-predicate execution**

open(service,null) captures defaults from the first network as baseValues. openServiceOnNetwork then changes the selected network without reseeding the clean baseline. The exact dirty predicate is false for untouched first-network defaults and true for untouched context on a different network. Workspace routes Cancel through pending-work resolution.

Impact: An untouched context-prefilled form can immediately show unapplied work and demand an Apply/Discard decision. Choosing Apply then has no service name. The same action behaves differently depending on network ordering.
Method: Current creation/default and navigation source read; current dirty predicate executed with corresponding controlled field values.
Integrated status: Integrated Cancel/Save reproduction REQUIRED

### Reproduce
1. Create two networks and save the fixture.
2. Inspect the second network and choose Add service on this network.
3. Do not type or change any control. Inspect the draft status and press Cancel.
4. Compare with creating on the first network. Then type a meaningful name and confirm ordinary draft protection remains.

### Required correction
Establish a contextual initial draft baseline after applying deliberate creation defaults. Keep actual user changes and copied-service intent distinct. Do not erase explicit classification or foundational overrides.

### Acceptance
- Untouched contextual defaults do not force a loss decision.
- The first meaningful user edit becomes pending.
- Cancel returns to the originating network and view context.
- Create similar service retains its explicit source/destination review contract.

### Source and evidence
- [src/ui/editor-panel.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/editor-panel.ts): openServiceOnNetwork; open baseValues; hasPendingDraft
- [src/ui/forms.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/forms.ts): service.values first-network defaults
- [src/ui/workspace.ts](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/src/ui/workspace.ts): openServiceOnNetwork and requestCancel
- `evidence/draft-predicate-results.json`

## WG09: The exact post-PR-26 executable is not retained as a retrievable CI artifact
**P0 | Release-qualification evidence gap | connector and workflow verification**

The current CI workflow builds and tests but has no artifact-upload step. The checked PR run artifact list returned empty. This session could not retrieve a current built HTML, access the disconnected desktop/browser, or navigate file:// in the cloud browser due administrator policy.

Impact: A source merge and a reported green gate cannot be independently inspected as the exact distributed application. Full-feature interaction, actual exports, native file operations and release aesthetics remain unverified here.
Method: Current ci.yml read; GitHub Actions artifact API checked; connected-device availability checked; cloud file navigation attempt recorded.
Integrated status: Blocks this requested integrated UAT, not evidence of an application failure

### Reproduce
1. Build an exact clean candidate with the declared toolchain.
2. Retain dist/sim.html, SHA-256, full source/tree identity, build metadata, test reports and relevant traces/screenshots.
3. Retrieve that retained artifact and exercise it offline in the supported browser channels.

### Required correction
Retain a bounded CI verification artifact from the checked subject, without automatically publishing a release. Separate candidate retention, artifact qualification, and authorized public release. Record and compare hashes on the file actually used.

### Acceptance
- The candidate HTML can be retrieved and its identity verified independently.
- No production/runtime dependency or telemetry is introduced.
- Native file tests, integrated UAT, synthetic review and real user validation are separately reported.
- Do not label this packet or existing CI as complete user acceptance.

### Source and evidence
- [.github/workflows/ci.yml](https://github.com/SUaDtL/SIM/blob/90d04afe422804b1922417cdc719dd7ff2e4dec8/.github/workflows/ci.yml): check job: checkout/setup/npm ci/npm run check only
- [GitHub Actions artifacts](https://github.com/SUaDtL/SIM/actions/runs/43762954206): run 43762954206
- `evidence/verification-boundaries.json`
