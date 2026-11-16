# Release-readiness map repair

R04 and R19 are implemented; V02 is confirmed and repaired. V03 is a confirmed existing display limitation, now explicitly disclosed in live and captured map legends. No complete obstacle router was introduced.

## Verification

Baseline app SHA `18b1d4a09ff1b6f62eee0985f276525a48f23d8916d884d1dd0f8d794bb8288e`: five original Chrome regressions failed exactly for unavailable focus subjects (delete, retire, merge), hidden zero-filter empty state and inert Back from focus after workspace history restore. See `map-red.log`.

Root build 1: 12/14 passed. The two R19 failures exposed a test precondition: initial Fit was still queued when the pre-filter frame was read. A two-frame settled-load prerequisite was added; exact viewport/position equality assertions remain. Source review then identified isolated and historical invalid-focus framing gaps; both new actual-app tests reproduced RED on build1 before the viewport extension was applied (`map-isolated-red.log`, `map-history-invalid-red.log`).

Root build 2 SHA `7ca4aa1b351fd7ca5e71733f39a73f552eb50e47c110a3db9c30c8b7b2fc7d70`: all 18 Chrome/Edge cases pass, process exit 0, `map-green-build2.log`. Scoped ESLint and Prettier pass. Full gate/hosted checks remain root-owned.

## Product behavior

- Missing focus subjects end focus with an explanation and restore the pre-focus viewport while retaining current projection, compatible filters and saved positions. Undo restores data without silently re-entering old focus.
- Focused navigation entries retain a bounded unfocused checkpoint, so Back from focus remains functional after workspace Back. Invalid historical focus also recovers its unfocused frame.
- Empty dataset, zero filter results and no recorded/visible dependency links have distinct explanations. Clear map filters recovers the exact arrangement and viewport without writes. Capture is unavailable with no visible nodes and rechecks scope after draft resolution. Rendering failures remain the shell recovery boundary.
- Capture saved-state wording is Includes changes not saved to file.

## Seven-network display observation

A synthetic seven-network map has exactly one recorded service1-to-service8 dependency. Its straight red line crosses unrelated Domain4's container interior. This was visually inspected at baseline and in both current browser screenshots; graph endpoints and saved repository bytes remain unchanged. The implementation intentionally treats leaves/headings as bounded obstacles and does not route around whole unrelated containers. Current live and SVG legends state Crossing another network box does not imply transit. This is an explicit limitation, not a fully repaired geometric router.

No native OS, human-participant or assistive-device acceptance is claimed. No old tests, source outside owned paths, native work/spec/plan records, Git commits or build outputs were authored by this worker.
