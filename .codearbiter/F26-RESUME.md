# SIM F26 local checkpoint

- Work: WORK-558058DEB941EE8B8ED8A42A7DBF20E6; SPEC-FILE-RECOVERY and PLAN-FILE-RECOVERY.
- Branch: codex/sim-f26-recovery, based on main a8a330c66f4b075dedc6e40c17fb122359a77fe3.
- User selected optional, explicitly chosen recovery sqlite, applied content only, one latest snapshot and manual Open after crash.
- Implementation: exact-byte native baseline checks, serial writes, separate recovery file, debounce, retry/stop controls, alias refusal, cancellation generation, lifecycle disposal.
- Local full `npm run check` passed on Windows with the final source and rejected-close test: typecheck, lint, format, build, 316 unit tests and 194 Edge/Chrome browser tests. The focused file/recovery suite also passed 9 tests.
- Independent review caught a delayed-selection Stop recovery race. It was reproduced in Chrome; the new regression failed against the earlier built app and passed in both browsers after rebuilding the generation-token fix.
- Focused mutation checks transpiled isolated in-memory copies of the actual file module. Removing the byte comparison or both stopped-operation checks caused required-rejection assertions to fail; unchanged production passed both assertions. No production source was mutated by these checks.
- Numeric coverage has no configured tool/provider; lines and branches remain unmeasured (CTX-TECH-STACK FACT-002). No numerical threshold pass is claimed.
- Browser tests use picker/file stubs. Real native recovery writes, permission refusal, reopen after browser exit, and external-writer behavior remain a user checkpoint. No cross-process CAS, lock or power-loss durability is claimed.
- The user authorized committing F26 and opening its SIM PR. Resolve the current commit and PR from `codex/sim-f26-recovery`; this record does not authorize merge or release.
- Independent scoped coverage review closed with no remaining HIGH/CRITICAL finding. Native acceptance remains pending.
- Next increment: `.codearbiter/CONNECTED-UX-HANDOFF.md`, based on the newly supplied Connected UX packet. Its requirements have not been implemented by F26.

## Native checkpoint

1. Open `dist/sim.html` directly in Chrome/Edge; use synthetic data. Save a primary temporary sqlite and choose a different recovery sqlite.
2. Apply an edit; wait for Recovery copy updated. Confirm primary remains unsaved. Type another edit without applying it.
3. Close/reopen SIM and Open the recovery sqlite: applied edit present, unapplied text absent. Re-enable recovery explicitly if desired.
4. Open the same primary sqlite in two SIM tabs. Save an edit in the first; saving from the stale second tab must refuse overwrite. Save As to a separate file must work.
5. Try selecting the primary file as recovery (and vice versa); SIM must refuse. Stop recovery must retain the file and prevent later automatic updates.

Preserve the old coherence worktree and unrelated local governance changes.
