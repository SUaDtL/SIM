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
- Links to foundational services (such as identity and DNS) are hidden on the map by default,
  so cross-domain paths stand out; "Show foundational links" brings them back without moving
  anything. A new service named Identity or DNS starts out marked foundational.
- The map keeps its arrangement: node positions are saved in the dataset (schema v2), drag
  networks and services to arrange the view, new nodes are placed without moving anything
  else, and "Re-layout" (after a confirmation) arranges everything afresh. Datasets from
  schema v1 open and are laid out once, which leaves them unsaved until you save.
- Click a service, network or CDS to highlight everything that chains to it: what it depends
  on, what depends on it, and the CDS on those routes, including foundational links. The rest
  of the map fades; click the background to clear. Filter the map by network, category or
  organization (one that provides, supports or consumes a service) without moving anything.
- Classification banner at the top and bottom of the app showing the highest marking in the
  dataset, colored by level (green, purple, blue, red, orange), with an optional caveat such as
  "SECRET//REL TO USA, FVEY" set from "Banner caveat". A caveat may use only letters, digits,
  spaces, commas, hyphens and slashes; a file whose stored caveat breaks that rule is refused.
- "Export PNG" saves the map as it is shown (zoom, highlight and filters) at twice screen
  resolution for slides, framed by the classification banner top and bottom.
- "Export SVG" saves the same view as a vector image that stays sharp at any size and can be
  edited in slide tools: shapes and text, every label, highlight and filters as shown, and the
  classification banner top and bottom. Names are written as plain text, never as markup.
- Undo and Redo (buttons, Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z) for every edit, including drags and
  Re-layout; adding a service and its placement on the map is one step. SIM asks before New or
  Open discards unsaved edits, and the browser warns before closing the tab. "Find on map"
  brings a node into view by name and highlights its chain.
- Map readability: when the map is zoomed out too far to read them, service labels are hidden
  until you hover a node, highlight its chain or zoom in; network and CDS labels grow so the
  structure stays readable; labels have a white halo over lines. Exports show every label. An
  end-to-end check now measures edge crossings, label overlaps and network overlaps on a
  ~100-service map, so later changes cannot quietly make the layout worse.
- "Open demo" opens a fictional demo enterprise: six networks and a cloud SaaS zone, about a
  hundred services, three CDS and several providing organizations, all marked UNCLASSIFIED with
  the banner caveat "DEMO - FICTIONAL DATA". The layout check uses the same dataset.
- A CDS is never drawn on top of a network's box; a layout that lands one there moves it out.
- "Import CSV" adds records from CSV files, one per template (networks, organizations,
  categories, applications, services, CDS, support tiers, consumers, dependencies); the templates
  download from the dialog. A preview shows what will be added, what is already in the dataset
  (left unchanged) and which rows are refused, with their row numbers and reasons. Rows that look
  like host data are left out unless chosen. The whole import is one undo step, and a large import
  lays out the map afresh.
