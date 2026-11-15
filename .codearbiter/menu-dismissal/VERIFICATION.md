# Floating-menu dismissal — PR25

User request: menus must close when clicking elsewhere. The supplied screenshot showed Filters, Layout and Capture options open together. Parent commit: `8d23db4`. Native fix: `WORK-FD5B6091DAA815062084C5F9A1B8E7F6`; inline bug criteria are used, without inventing a new feature spec/plan.

## Cause and repair

Native `<details>` preserves its own open state. The map had only local Escape handlers; File/About closed only on their own actions. Record and connection menus had the same missing outside-dismissal behavior. A single delegated controller, installed once in the application bootstrap, now covers all seven floating-menu selector categories, including dynamically rendered records. Outside pointer presses, outside clicks, focus leaving, another menu opening, chosen actions and Escape dismiss the appropriate menus. Inside filter controls remain usable. Inline CSV/receipt disclosures do not participate.

Click handlers run before delegated action dismissal; no pointer/click cancellation or deferred reactivation was introduced. Modal focus and the next clicked control retain ownership. Escape and completed menu actions return focus to the trigger where appropriate.

Two embedded multi-step tasks surfaced during integration: route forms and edit-footer deletion confirmation lived inside closing menus. Both now move to an editor surface through `exposeMenuTask`; Cancel restores their original action position and the visible menu trigger. Delete confirmation uses the scrollable editor body, avoiding an expanded sticky footer. Existing route, blocked-delete, consequence, stale-plan, draft and Undo assertions remain unchanged.

## Obligations and observed evidence

| ID | Required behavior | Proof |
| --- | --- | --- |
| MENU-01 | One floating menu at a time; outside actions/canvas dismiss it | Named map/document regressions and actual demo walkthrough |
| MENU-02 | Filter interaction remains usable; leaving focus/Escape dismisses coherently | Keyboard/select/checkbox and next-control focus regressions |
| MENU-03 | Menu actions actually run, including cancelled layout and SVG download | Action regression with native dialog cancellation and download event |
| MENU-04 | Dynamic record/connection menus preserve drafts and selected actions | Rendered record, staged dependency and no-Undo assertions |
| MENU-05 | Inline disclosures and modal focus remain valid | Import disclosure characterization plus strengthened modal-focus assertion |
| MENU-06 | Route/delete subflows remain visible after menu dismissal | Two precise failing intermediate regressions, corrected task placement, Cancel/focus assertions and existing unchanged integration tests |

Before repair, six primary regressions failed for retained open attributes on the built parent; the inline-disclosure characterization passed. The initial controller exposed two hidden-task defects; both named tests failed on visibility before their repair. The corrected candidate passed 68 focused Chrome/Edge integration checks. Two older test setups then needed to reopen menus before inspecting their contents; all their assertions, timeouts and skip states are retained, and all four targeted host checks passed.

Final `npm run check` exited 0: typecheck, lint, formatting, standalone build, 388 unit tests and 460 offline Chrome/Edge browser checks. Actual 200% and 400% browser zoom passed. Initial lint/failed/interrupted runs were corrected; only the final complete run is claimed as the full pass. Numeric coverage remains unmeasured under `CTX-TECH-STACK#FACT-002`'s declared no-tooling exemption.

## Independent review

One coverage-auditor unit reached DONE. It verified source hashes, retained RED/GREEN evidence, unchanged integration contracts and the two test adaptations. It independently exercised narrow-screen deletion in Chrome and Edge and route editing in Chrome, observed no overflow/history changes, and scanned all seven menu categories for further embedded task twins. None remained.

Sequential finding-triage and verdict-aggregator returned PASS: zero blocking, zero open deferrable and zero incomplete findings; two historical MEDIUM integration findings are retained as NON_BLOCKING/CLOSED. Source epoch is recorded in `SOURCE-SHA256.json`. This is scoped technical review, not human aesthetic acceptance.

## Local checkpoint and delivery boundary

Open `C:\Users\brenn\Downloads\SIM-PR25-Checkpoints\05-menu-dismissal.html` directly in Chrome or Edge. It matches `dist/sim.html`; verify its digest in the manifest. The actual demo walkthrough showed exactly one map menu open after Filters → Layout → Capture options, and route/deletion tasks visible outside menus at 320px without horizontal overflow or runtime errors. Local images remain in `05-visual-review`; text observations are retained here.

Try Map → Filters → Layout → Capture options, then click the canvas or another control. Filter choices should remain usable inside Filters. Also try a connection's Edit route and an edit-footer Delete → Cancel. Menu dismissal must retain the draft and task focus.

Native work completion records implementation progress. Hosted CI belongs to the eventual committed head and is reported separately on PR25. Native OS file-picker operation was not independently repeated. No merge, release or real-participant acceptance is claimed.
