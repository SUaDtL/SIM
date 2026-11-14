# Changelog

All notable changes to SIM are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Release tags are prefixed `v` (e.g. `v0.1.0`).

## [Unreleased]

### Added

- Bundled offline workflow Help, persistent qualified editor identity, a live map legend and visible scope/hidden-dependency disclosure.
- Complete paginated CSV reconciliation and session-local completed-import receipts with downloadable diagnostics, source/classification metadata and spreadsheet formula protection.
- Complete project/runtime license and attribution texts embedded in the standalone HTML from the installed production dependency closure; missing or unqualified runtime license texts fail the build.
- Display-only edge avoidance and proportional PNG/SVG framing for presentation-sized annotation readability, with explicit recorded-dependency uncertainty and capture scope.
- Read-first record summaries, Inventory/Map workspaces, a wider tabbed aggregate editor and searchable reference pickers with inline creation.
- Independent Create similar service drafts with explicit destination and optional support copying; bounded inventory and relationship collections with qualified identities.
- File/About and contextual map controls, direct PNG Capture, draft return paths and narrow/zoomed form reflow.
- Optional chosen-file recovery for applied changes, with separate status, retry and stop controls; native saves refuse an externally changed file.
- Contextual creation of missing service references while preserving the parent draft, with atomic initial service relationships.
- Typed partial Find, read-only reference peeks, recorded reverse relationships and Back with restored list and map context.
- Direct dependency route editing, distinct incoming and outgoing ownership, and shared connection inspection with projected provenance.
- Directional and network-boundary map focus, explicit expansion, faithful focused PNG/SVG capture and a responsive editor focus mode.

### Fixed

- Keep keyboard focus on an enabled pagination control at first/last-page boundaries in relationship lists, checklist choices and import diagnostics.
- Dismiss floating menus when another menu opens, focus or a click moves elsewhere, an action is chosen or Escape is pressed; preserve filter editing, modal focus and inline disclosures.
- Open populated inventories on Services with direct network scope, separated service context and per-type search/page/scroll memory; preserve keyboard visibility and complete browsing context through selection and Back.
- Align action/menu/picker controls consistently and remove unused search and paging from empty relationship groups; distinguish creation, Apply and file saving in editor guidance.
- Give the workspace a dark technical palette, quieter navigation, structured inventory rows and responsive two-column forms; preserve dark map backgrounds and label halos in capture and keep file feedback readable.
- Read-summary refresh preserves Apply notices and does not interrupt file saving by advancing the draft token.
- Sensitive-input confirmation binds all changed service fields and support notes to the exact current draft.
- Rejected navigation leaves filters, selection, framing and drafts unchanged; stale navigation decisions cannot cross a dataset replacement.
- Relationship refresh retains unadded choices and focus, foundational counts describe visible routes, and capture progress and errors remain visible.

## [0.1.0] — 2026-11-12

### Added

- The map's View list shows As-Is, any To-Be scenario, or one map comparing a scenario with As-Is: added and merged-into services in green, re-homed ones purple and dashed, retired and merged-away ones as faded ghosts, with the change in service count and cross-domain connections; scenario views never move saved positions.
- To-Be scenarios record changes over the As-Is services (add a service, retire one, merge one into another, re-home one to another network or provider) without changing As-Is, so later As-Is edits carry into every scenario; each change is one undo step, and a service a scenario adds counts on the classification banner.
- "Export SVG" saves the map view as a vector image that stays sharp at any size and can be edited in slide tools, with every label, highlight and filter as shown and the classification banner top and bottom.
- "Import CSV" adds records from CSV files, one per template (downloadable from the dialog), with a preview of what will be added, what already exists and which rows are refused and why; rows that look like host data are left out unless chosen, and the whole import is one undo step.
- "Open demo" opens a fictional UNCLASSIFIED demo enterprise: six networks and a cloud SaaS zone, about a hundred services, three CDS and several providing organizations.
- Zoomed out, service labels hide until you hover, highlight or zoom in, network and CDS labels grow, and labels get a white halo; a CDS is never drawn on top of a network's box, and an end-to-end check guards edge crossings, label overlaps and network overlaps.
- Undo and Redo (buttons, Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z) for every edit including drags and Re-layout, a prompt before New or Open discards unsaved edits, and "Find on map" to bring a node into view by name.
- "Export PNG" saves the map as shown (zoom, highlight and filters) at twice screen resolution, framed by the classification banner top and bottom.
- Classification banner at the top and bottom showing the highest marking in the dataset, colored by level, with an optional caveat set from "Banner caveat".
- Click a service, network or CDS to highlight everything that chains to it while the rest fades, and filter the map by network, category or organization.
- Node positions are saved in the dataset (schema v2): drag to arrange, new nodes are placed without moving anything else, and "Re-layout" arranges everything afresh after a confirmation.
- Links to foundational services such as identity and DNS are hidden on the map by default so cross-domain paths stand out; "Show foundational links" brings them back.
- Service map: each network is a box holding its services, external networks form a dashed zone, each CDS sits between the networks it joins, and dependencies are colored by how they travel (grey local, orange through a CDS, red dashed across a boundary with no CDS, tan to an external network).
- Side-panel data entry: add, edit and delete networks, services, organizations, applications, categories and CDS, and set Tier 1-3 support, consuming organizations and service dependencies, with errors shown at the field.
- Data rules with plain-language errors, IP/FQDN-like text flagged before saving, and CDS classified by the networks they join.
- Create, open and save SIM datasets as local .sqlite files; invalid or tampered files are refused with a clear message.
- The app now blocks all network access at the browser level, and unsafe code constructs fail the lint gate.

### Fixed

- Editing a CDS or moving a service can no longer break an existing CDS route, and a network a CDS joins cannot be deleted.

### Changed

- Project skeleton with offline single-file build and check gate.
