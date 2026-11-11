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
## DECISION-0002 — ADR-0002 — Forward-only schema migrations

**Date:** 2026-11-11
**Status:** accepted
**Supersedes:** none
**Decided by:** SUaDtL@users.noreply.github.com
**Decision category:** architecture
**Artifact-section-hash:** n/a

### Variance summary
- **Artifact position:** SPEC-SCHEMA-PERSISTENCE (SCOPE-2, AC-2) specified forward-only migrations without an ADR.
- **Scaffold position:** The migration review recommended recording the policy before migration 0002.
- **Status type:** open-decision-closure

### Decision
The user approved recording forward-only migrations (DECOMP-PROJECT Q-031):
up-only migrations, each atomic with its version bump; merged migrations are
never edited; newer datasets are refused. Recorded as ADR-0002 with status proposed.

### SMARTS rationale
Datasets are user-held files, so the safe recovery path is the unsaved original
file rather than an in-app downgrade; a stable meaning per schema version keeps
files portable across SIM builds.

### Implementation implication
Matches the existing runner (src/db/migrate.ts) and migration list; future schema
changes ship as new migrations with tests. Destructive migrations need explicit
review and a pre-save warning.

---
