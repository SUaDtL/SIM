---
status: proposed
date: 2026-11-10
title: Single-file offline HTML app with TypeScript, Vite, sql.js and Cytoscape.js
decided-by: SUaDtL@users.noreply.github.com
supersedes: none
governs: package.json, vite.config.*
---

# ADR-0001 — Single-file offline HTML app with TypeScript, Vite, sql.js and Cytoscape.js

## Status
Proposed

## Context
SIM must be a local-only HTML application the user can bring into almost any
location, including SIPR, with data kept in SQLite or a similar flat file
(DECOMP-PROJECT Q-002). A local Python server cannot be counted on once SIM is on
SIPR (Q-006). Visualization of services, networks and their provides/consumes
connections is 99% of the purpose (Q-001).

## Decision
Build SIM as one self-contained `sim.html`, opened from `file://` with no server,
install or network access. Source is strict TypeScript bundled by Vite with a
single-file plugin that inlines all JS, CSS and WASM. Data lives in SQLite via
sql.js (WASM) held in memory and persisted to a local `.sqlite` file through the
File System Access API where available, with a download/upload fallback. The
map is rendered with Cytoscape.js, bundled into the build. Approved by the user
during decomposition (Q-016).

## Alternatives considered
- **Local Python server** — not chosen: the user can run one personally, but it
  is unlikely to be permitted once SIM goes on SIPR (Q-006).

## Consequences
SIM runs anywhere a modern browser opens a local file, with nothing to install.
All dependencies must be bundled at build time; no runtime CDN or network fetch
is possible. Save-in-place depends on browser support for the File System Access
API; other browsers fall back to download/upload.

## Risks
Unverified until the file:// feasibility spike (DECOMP-PROJECT WORK-001):
inlined sql.js WASM may not load from `file://`, and File System Access API
save-in-place may be unavailable from `file://` or disabled by enterprise
browser policy. Cytoscape.js compound-node layout readability at ~100 services
is checked by the layout spike (WORK-002). Either failing would reopen this
decision.
