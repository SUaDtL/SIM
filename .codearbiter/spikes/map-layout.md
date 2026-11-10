# Spike: map layout at scale (WORK-002)

**Date:** 2026-11-10
**Status:** Answered: feasible, with design changes recommended
**Timebox:** 1 day / one session (finished within the session)

## Question

Can Cytoscape.js render 6 networks plus an external SaaS zone with ~100
services and CDS nodes readably? Which layout and edge style work best? Do
PNG/SVG exports carry the classification banner? The user stressed that
connection pathing and visual coherence must impress picky customers.

## What was tried

- Synthetic UNCLASSIFIED dataset: 6 networks plus External/SaaS, 98
  services, 3 CDS nodes, 246 edges, with duplicate services from different
  providers (J6 vs J7).
- Networks drawn as compound nodes. CDS drawn as top-level diamond nodes, with
  cross-domain links split into source→CDS→target.
- Edge classes: local (grey), via CDS (orange, solid), cross-domain without a
  CDS (red, dashed), to SaaS (tan, dotted).
- Layouts: fcose, ELK layered (INCLUDE_CHILDREN) and ELK stress, each with
  bezier and taxi (orthogonal) edges, scored over 3 runs each.
- Metrics: straight-line edge crossings, label-box overlaps, network-box
  overlaps, CDS distance to its networks' boundaries, layout time.
- Screenshots: Edge 157 at 1920×1080 via Playwright.

## Results (73 services, all links)

| Layout | Crossings | Label overlaps | Net overlaps | CDS gap px | ms |
|---|---|---|---|---|---|
| fcose | ~210 | 7–13 | 0–1 | ~370 | 15–42 |
| ELK layered | 337 | 1 | 0 | 849 | 85–194 |
| ELK stress | 501 | 3 | 0 | 3659 | 64–78 |

ELK layered with taxi edges looked like a wiring diagram but turned into
spaghetti inside networks, and placed CDS nodes far from their boundaries.
**Rejected.** fcose kept networks compact and put each CDS between the
networks it joins with no extra logic.

## Results (98 services, fcose)

| Variant | Crossings | Label overlaps |
|---|---|---|
| All links | 543–577 | 27–30 |
| Foundational links (Identity, DNS) removed | 14–23 | 59–68 |
| Laid out with all links, then foundational hidden | 32–40 | 24–30 |
| **Foundational removed + fcose tiling padding** | **19–23** | **16–19** |

Root cause of the clutter: nearly every service consumes its network's
Identity and DNS, which turns each network into a hub-and-spoke hairball.
Hiding those links cut crossings by ~25× and made the real story visible:
cross-domain paths, CDS flows, SaaS dependencies and duplicated services.
fcose then packs services with no visible links tightly; the
`tilingPaddingVertical/Horizontal` options space them into a clean grid.

## Other checks

- Chain highlight (transitive predecessors + successors, everything else
  dimmed to 8%) works, including across CDS hops. For SIPR C2 Common Op
  Picture the chain was 19 nodes and 28 edges, spanning MPE → SIPR → NIPR.
- PNG export (`cy.png` at 2× scale, composited onto a canvas with top and
  bottom banners) and SVG export (`cytoscape-svg` wrapped with banner bars)
  both carry the highest marking (SECRET). Gap: the banner font is a fixed
  16 px, so it looks tiny on a 3118 px-wide 2× PNG. Scale it with the export.
- Bundle size with cytoscape, fcose, ELK and cytoscape-svg: 2.0 MB single
  file (630 KB gzip). ELK is about half of that; dropping it roughly halves
  the size.
- Layout time is under 60 ms at 98 services; performance is not a concern.

## Problems still visible

- fcose is non-deterministic: networks land in different places each run.
  A consultant's map must not rearrange itself between sessions.
- Some labels still collide in dense clusters (e.g. SIPR C2/GIS/Planning).
- Bezier curves through a CDS converge into a fan. Readable, but no edge
  bundling yet.

## Recommendations (need user decision before they enter the plan)

1. **Foundational services.** Add a per-service "foundational" flag
   (default: Identity, DNS; user-editable). Links to foundational services
   are hidden by default, with a toggle to show them, and always appear in
   chain highlights.
2. **Persisted layout.** Run fcose once, then save every node position in the
   dataset. Users drag networks and services to arrange the briefing view.
   "Re-layout" is an explicit action, and new nodes are placed incrementally
   (fcose with fixed-node constraints) without moving the rest.
3. **Drop ELK.** fcose only; this halves the bundle size.
4. **Bezier edges by default.** Taxi is not worth it with compound nodes.
5. **Polish backlog:** label collision avoidance (or hover-only labels for
   small nodes when zoomed out), banner scaled to export size, optional
   bundling of CDS flows.

## Implications

- ADR-0001's choice of Cytoscape.js holds. No change needed.
- WORK-007 (map view) should include the foundational toggle, tiled packing
  and persisted positions if the user approves recommendations 1 and 2.
- Rebuild the scoring harness (crossings and overlap metrics) as a
  regression check in the real e2e suite, so future visual changes can't
  quietly make the map worse.
