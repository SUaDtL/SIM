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
