## DECISION-0001 — ADR-0001 — Single-file offline HTML app with TypeScript, Vite, sql.js and Cytoscape.js

**Date:** 2026-11-10
**Status:** accepted
**Supersedes:** none
**Decided by:** SUaDtL@users.noreply.github.com
**Decision category:** architecture
**Artifact-section-hash:** n/a

### Variance summary
- **Artifact position:** No prior artifact; the stack was open during decomposition.
- **Scaffold position:** Proposed a single offline sim.html built with TypeScript and Vite, sql.js storage and Cytoscape.js rendering.
- **Status type:** open-decision-closure

### Decision
The user approved the proposed stack ("works for me") during decomposition
(DECOMP-PROJECT Q-016): one self-contained offline sim.html from strict
TypeScript and Vite, sql.js with File System Access API save and download
fallback, and Cytoscape.js for the map. Recorded as ADR-0001 with status proposed.

### SMARTS rationale
Driven by the deployment constraint: SIM must run on SIPR workstations where a
local server cannot be assumed (Q-006), so everything must run in the browser
from a local file with no install or network access.

### Implementation implication
Project skeleton (WORK-003) follows this stack; the file:// feasibility spike
(WORK-001) and layout spike (WORK-002) test its risks before the skeleton is built.

---
