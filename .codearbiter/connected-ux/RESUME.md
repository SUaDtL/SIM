# SIM Connected UX resume

## Identity and current outcome

- Branch: `codex/sim-f26-recovery`; existing draft [PR24](https://github.com/SUaDtL/SIM/pull/24).
- Work: `WORK-982097E0781E04B13C7F18321630004D`; native `SPEC-CONNECTED-UX` and `PLAN-CONNECTED-UX`.
- Preserve F26 commit `a70d59843cf295d9405d7570b7221112d9d82666` on this same branch. User explicitly rejected a separate branch/PR.
- Connected UX implementation covers bounded inline reference creation, atomic initial service relationships, exact aggregate host-text confirmation, typed search/peek/Back and projection lifecycle, explicit dependency ownership and route repair, directional/network focus and capture, responsive editing, diagnostics and truthful status.
- Source/test bytes are bound in `SOURCE-IDENTITY.json`; per-case results are in `EXECUTION-STATUS.json`, all F01-F23 dispositions in `FINDINGS-STATUS.json`. Test/review/visual evidence and analysis-only ADR proposals are adjacent.

Final local `npm run check` passed 342 unit and 296 browser tests; all 73 cases passed. Native plan tasks are DONE and work implementation complete. Exact delivery commit/hosted CI is on PR24; native acceptance remains pending.

## Continue safely

1. Inspect Git status and the exact branch/PR head. Do not reset, stash, delete native recovery metadata or stage `.codearbiter/views/` derived snapshots. Preserve unrelated worktrees.
2. Read `TEST-RESULTS.md`, the per-case tracker and the current exact-head hosted checks. Native plan DONE and work complete mean implementation progress, not owner acceptance, merge or release.
3. Keep the PR draft until the owner completes the native F26 acceptance checkpoint or explicitly changes that delivery boundary. Do not claim ordinary earlier Save tests proved optional recovery.
4. Any new confirmed defect resumes the same authorized feature/fix lane with a failing regression. No dependency, schema or runtime-storage change is part of this packet. ADR proposals require the decision owner through `$ca-adr`; accepted history is unchanged.

## Local acceptance steps for the owner

Open `C:\Users\brenn\.codex\worktrees\sim-f26-recovery\SIM\dist\sim.html` directly in Chrome or Edge and use fictional data.

1. Start Add service in a new dataset; type a name and description. Create network and provider inline. Cancel a child once, then create it. Verify parent values and focus survive. Add support, consumption and dependency before first Add. Save and reopen.
2. Search a partial name, inspect a reference and follow a reverse relation. Type an unapplied edit, attempt another result, choose Stay. Verify no map/list jump. Accept navigation and Back; verify prior filter and framing.
3. Edit a dependency route with another field, Apply, then Undo/Redo. Inspect an incoming connection and navigate to its consumer owner. Check duplicate names include their networks and projected connections remain read-only.
4. Select a service/network, try Depends on, Used by, Network connections, Expand focus, Fit and Back. Export PNG/SVG and check route, scope, legend and full classification. Try Capture current view with a dirty draft. Resize to laptop width and use Focus editor.
5. Save a primary temporary sqlite and choose a separate recovery sqlite. Apply an edit and wait for Recovery copy updated. Leave another edit unapplied, close/reopen SIM, Open recovery: only the applied edit should exist. Recovery must be explicitly re-enabled.
6. Open the same primary file in two SIM tabs. Save from one, then attempt a stale save from the other: overwrite must be refused; Save As must retain that tab's work separately. Refuse primary/recovery alias selection. Stop recovery should retain the last copy and stop later updates. If permission denial is available, verify failure and retry without losing the draft.

Report which steps and browser you used. These checks do not authorize merge or release.
