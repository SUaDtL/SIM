# Spike: file:// feasibility (WORK-001)

**Date:** 2026-11-10
**Status:** Answered — feasible
**Timebox:** 1 day / one session (finished within the session)

## Question

Can a single Vite-built `sim.html` with sql.js (SQLite WASM) inlined run
offline from `file://` in current Edge and Chrome? Specifically:

1. Does SQLite load and run queries with the network blocked?
2. Is File System Access API save-in-place available from `file://`, and does
   it actually overwrite the file?
3. Does the download/upload fallback work?

## What was tried

- Throwaway app: Vite 8.3.7 + `vite-plugin-singlefile` + TypeScript +
  sql.js (SQLite 3.54.1). The WASM binary was imported with
  `sql.js/dist/sql-wasm.wasm?url`; the single-file plugin inlined it as a
  `data:application/wasm` URL, decoded to bytes and passed to
  `initSqlJs({ wasmBinary })`, so no fetch happens.
- Output: one `index.html`, 962 KB (445 KB gzip). The only `http(s)` string in
  it is a comment link inside sql.js; no external `src`/`href`.
- Playwright (automated) against the installed browsers, opened via
  `file://`, with `context.setOffline(true)` and all `http(s)` requests
  aborted: Edge 157 and Chrome 156 (headless).
- Manual save-in-place check by the user in Chrome and Edge (the native save
  dialog can't be automated).

## Answer

| Check | Edge 157 | Chrome 156 |
|---|---|---|
| Loads offline from file://, SQLite runs | pass (auto) | pass (auto) |
| `isSecureContext` on file:// | true | true |
| `showSaveFilePicker` / `showOpenFilePicker` present | yes | yes |
| Save as → save in place → reopen shows rows | pass (manual, user) | pass (manual, user) |
| Download fallback produces valid SQLite file | pass (auto) | pass (auto) |
| Upload fallback restores rows | pass (auto) | pass (auto) |
| Network requests made | none | none |

ADR-0001's stack is feasible on this machine. Whether the browser prompted
for permission during save-in-place was not reported.

## Gotchas found

- Vite 8 on Windows: importing the WASM with `?inline` failed
  (`UNLOADABLE_DEPENDENCY ... os error 123`). Use `?url`; the single-file
  plugin inlines it anyway.
- Vite 8 warns unless `package.json` has `"type": "module"` for an ESM
  `vite.config.ts`.

## Not answered (accepted)

Whether a given SIPR/NIPR browser policy disables the File System Access API.
The user decided (2026-11-10): every SIPR and NIPR differs; develop against
the current environment and handle restrictions if they ever come up. The
download/upload fallback stays in scope as the safety net.

## Implications

- WORK-003 (skeleton) can proceed on ADR-0001's stack as written, using the
  `?url` WASM import and `"type": "module"`.
- The Playwright offline `file://` harness (Edge + Chrome channels,
  `setOffline` + `http(s)` abort + request recorder) is a good model for the
  e2e suite in WORK-003; rebuild it there, don't copy spike code.
- Save-in-place needs a user gesture and a picker on first save; keep the
  file handle for later saves in the session.
