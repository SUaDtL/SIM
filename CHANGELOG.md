# Changelog

All notable changes to SIM are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Release tags are prefixed `v` (e.g. `v0.1.0`).

## [Unreleased]

### Added

- Project skeleton: single-file offline build to `dist/sim.html` with SQLite (sql.js) inlined,
  strict TypeScript, lint/format, unit tests, offline `file://` end-to-end tests in Edge and
  Chrome, and one `npm run check` gate.
- Content Security Policy in `sim.html` that blocks all network access, and lint rules that
  reject unsafe code constructs (eval, raw HTML injection, network and browser-storage APIs).
- Datasets: New, Open, Save and Save As. Saves in place to a local `.sqlite` file in Edge and
  Chrome (download/upload elsewhere); refuses files that are not valid SIM datasets with a
  clear message. Schema v1 covers networks, services, applications, categories,
  organizations, Tier 1-3 support, CDS and provides/consumes links.
- Data rules: names, markings and links are validated with plain-language errors; a CDS
  route must join the two networks it connects; text that looks like an IP address or host
  name is flagged and saved only after confirmation; a CDS takes the highest marking of the
  networks it joins. Editing a CDS or moving a service cannot break an existing CDS route,
  and a network a CDS joins cannot be deleted.
- Data entry: a collapsible list on the left and an editor on the right, with the center kept
  for the map. Add, edit and delete networks, services, organizations, applications,
  categories and CDS; set Tier 1-3 support, consuming organizations and service dependencies
  (optionally through a CDS). Errors appear at the field; host-like text needs "Save anyway".
- Service map in the center: each network is a box holding its services, external networks
  form a dashed external zone, and each CDS sits between the networks it joins. Dependencies
  are colored by how they travel: grey within a network, orange through a CDS, red dashed
  across a boundary with no CDS, tan to an external network. Pan, zoom, "Fit map", and click
  a node to edit it; the map follows edits as they are saved. Uses Cytoscape.js with the fcose
  layout, bundled into the single file.
