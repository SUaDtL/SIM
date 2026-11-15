## Finding Triage Report — bounded CI-label repair — 2026-11-15

Terminal state: DONE. Current active findings: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0.

### Complete batch contract

This is a new bounded ca-review batch for the hosted-CI font-cap repair. The sole required producer is ci_label_coverage, acting as coverage-auditor. Its actual complete DONE result is required. Scope is src/map/map-view.ts, src/map/style.ts and e2e/layout-quality.spec.ts: font formula, matching comments and direct regression evidence only. Security, crypto, dependency, migration and ADR-drift reviewer units were not selected for this narrow delta; none is counted as a missing unit. Prior full readiness review and historical findings remain retained separately.

Current source epoch: d86dd6df565da6ccf4b541e723140754c23797526fbf42f1ea994ed09e8fd01b. Current source manifest: ci-label-source.json. The initial bounded epoch was 9b4eb6f783e3113c65995d15c9866add61ee13da6a116c113e7eeb2dccb7e886; the coordinator reported the subsequent delta as a single stale historical twice-size comment correction. The producer reselected and consumed its final packet, verified all 146 final manifest hashes and confirmed the exact three-path diff before completing. This packet binds to the final epoch, not the earlier one.

R05 publication, G01–G07 separate capability/scoping work, V03 disclosed geometry and V04 native/participant acceptance remain unchanged and separate. This review adds no merge or publication authority.

### Admission and producer accounting

Read the complete current ci-label-review-input.json and final producer report. The installed finding-triage instructions apply; current CONTEXT.md remains stage 1, HTML context. Verified the producer report's actual SHA-256 against its delivered digest. No application source or test behavior was independently investigated by triage.

| Required unit | Actor | Terminal state | Verified report | SHA-256 | Findings |
|---|---|---|---|---|---|
| coverage | coverage-auditor / ci_label_coverage | DONE | ci-label-coverage.md | 6ee32334f0ed094a8960c855fde35504b4f9737caaa30bba53f00b01542d38ad | Explicit none: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0 |

Expected producers 1 / DONE 1 / ERRORED 0 / DEFERRED 0 / MISSING 0. Triage unit DONE 1. The actual terminal report was available before substantive classification. No finding, error, deferral or producer result was omitted; no deduplication is needed.

### BLOCKS — current findings

Explicit none.

### DEFERRABLE — current findings

Explicit none.

### NON_BLOCKING — current findings

Explicit none.

### INCOMPLETE_RESULT — review batch

Explicit none. The sole dispatched producer supplied a complete terminal report with verified artifact admission.

### Retained evidence and qualifications

The producer records the hosted symptom at head3cfbbd4: a network label rendered10.961160381810211px against the retained >=11px baseline, while725browser cases passed. It identifies the shared base-times-two cap as the cause for both network and CDS label growth. The qualified fixed-zoom RED observed network10/CDS8 against expected13/11 at zoom0.25. Current tests retain the same screen-size oracle rather than relaxing the original layout threshold.

The inspected repair uses max(base,min/zoom), retaining base behavior above each minimum. Supported Cytoscape zoom bounds0.1–4 bound model-space font size. The producer checked the class/font-only zoom path, unchanged persistence/placement ownership and the PNG/SVG scale-and-restore path. The leaf-position oracle correctly excludes compound network centers, which Cytoscape derives from child label bounds; old readability, overlap/crossing, tiny-label and hover/zoom assertions remain. No additional finding was identified.

The producer observed both hosts' fixed-zoom regression and existing layout/hover cases GREEN in ci-label-full-check.log, with its exact still-growing log-prefix length and digest retained in the raw report. That report deliberately does not assert a terminal complete local gate or exact-head hosted-CI verdict. A subsequent producer message relayed the coordinator's later report of local exit0 with393unit and728Chrome/Edge cases and a format-check exit0 after the comment correction. Those later coordinator-owned facts were not independently executed or certified by triage and do not silently replace the raw report's earlier observation boundary.

Numeric line and branch coverage remain unmeasured under the configured no-tooling exemption. Test totals are not a coverage percentage. No merge, publication, native file dialog/permission refusal, participant acceptance or final release-readiness outcome is certified by this triage.

### Summary counts

- Total current findings: 0.
- CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0.
- BLOCKS 0 / DEFERRABLE 0 / NON_BLOCKING 0 / INCOMPLETE_RESULT 0.
- Required producer units 1 / DONE 1 / ERRORED 0 / DEFERRED 0 / MISSING 0.
- Triage unit DONE 1.
- Previous readiness findings and their follow-up dispositions remain in their original packets and are not reclassified by this narrow batch.

### Execution integrity

Read-only report admission and classification. No new reviewer finding, source or behavior investigation, test/build/browser/native operation, repository/Git/dataset mutation or subagent dispatch. The sole newly owned TEMP output is ci-label-triage.md under the coordinator's explicit instruction; no prior report was overwritten. The verdict aggregator receives this complete packet and owns the aggregate verdict.
