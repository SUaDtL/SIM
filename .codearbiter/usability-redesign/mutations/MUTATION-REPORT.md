# SIM picker mutation evidence

All three targeted mutations were killed by existing tests. Applicable isolated baseline tests passed before mutation and after restoring exact original source bytes.

Isolation: `C:\Users\brenn\AppData\Local\Temp\sim-picker-mutation-8c062a1d34`. Dependencies were reused through a directory junction; no install ran. All build commands used the isolated working directory. No shared source mutations occurred.

## Baseline and restoration

- Component stale-owner / delayed-completion case: exit 0 before mutation; exit 0 after restore.
- Production child exact-warning case: isolated build exit 0; test exit 0 before mutation and after restore.

## Mutants

### owner-current

- File and original line: `src/ui/reference-picker.ts:74`.
- SHA-256 before: `382ed872fd245ee6d2d6410ae702ededaf6426905d6a1717d39b19b6dd49a253`.
- SHA-256 after: `261634038469de0022994854b7d3895798cf61db848e9081094a1ae8bbd99852`.
- Before:

```ts
    if (ctx.isCurrent?.() ?? true) return true;
```

- After:

```ts
    if (true) return true; // MUTANT: ignore owner-current guard
```

- Command: `node node_modules/@playwright/test/cli.js test e2e/reference-picker-component.spec.ts --project msedge --grep 'stale ownership and a completion after close' --output test-results/mutant-owner-current --reporter line`.
- Exit: 1; result: killed.
- Failure oracle: reference-picker-component.spec.ts:202 expected parent task changed; picker instead closed after selecting stale record.
- Retained log: `mutant-owner-current.log`.

### closed-dialog

- File and original line: `src/ui/reference-picker.ts:73`.
- SHA-256 before: `382ed872fd245ee6d2d6410ae702ededaf6426905d6a1717d39b19b6dd49a253`.
- SHA-256 after: `7ce164fa9fd2e34cce4029481f22acfca89bf9b71ce9c3bdc9d97fec05279bdc`.
- Before:

```ts
    if (closed) return false;
```

- After:

```ts
    // MUTANT: accept completion after dialog close
```

- Command: `node node_modules/@playwright/test/cli.js test e2e/reference-picker-component.spec.ts --project msedge --grep 'stale ownership and a completion after close' --output test-results/mutant-closed-dialog --reporter line`.
- Exit: 1; result: killed.
- Failure oracle: reference-picker-component.spec.ts:215 selected expected [] but got ["1"] after delayed completion on closed dialog.
- Retained log: `mutant-closed-dialog.log`.

### child-warning-withdrawal

- File and original line: `src/ui/editor-panel.ts:963`.
- SHA-256 before: `2852d98dafdd7f02b4eeae90a24a0f09a0453ece4816c2d97d8c0018cc4e9041`.
- SHA-256 after: `15e799333b5a992c5063543382875ca86206b96133fb20e807c0aa15751430c4`.
- Before:

```ts
                  form.addEventListener("input", () => {
                    confirmed = null;
                    confirm.hidden = true;
                  });
```

- After:

```ts
                  // MUTANT: do not withdraw child warning acknowledgement after input
```

- Command: `node node_modules/@playwright/test/cli.js test e2e/usability-picker.spec.ts --project msedge --grep "inline child's exact host warning" --output test-results/mutant-child-warning --reporter line`.
- Exit: 1; result: killed.
- Failure oracle: usability-picker.spec.ts:203 Save anyway expected hidden after changed child payload but remained visible.
- Retained log: `mutant-child-warning.log`.

## Shared-worktree observation

Shared picker and editor source hashes matched before/after. Shared dist changed while this isolation ran; the runner only built TEMP dist and records both shared hashes without attributing the concurrent change.

- Shared dist before: `0533252b9a0e0f513dc708036ce44013037b06495d3a39af75db7c3b84791bd9`.
- Shared dist after: `3c49802c46b3ae8f3f37ac21717b0543da4daba357b0061e4bd48695fc801865`.

Exact commands, hashes, logs and restore results are retained in `evidence.json`.

## Limits

Three targeted mutants, Microsoft Edge only, isolated source snapshot with shared read-only dependency junction; no dependency install. Not exhaustive mutation coverage.
