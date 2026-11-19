# SIM: Service Integration Map

[![ci](https://github.com/SUaDtL/SIM/actions/workflows/ci.yml/badge.svg)](https://github.com/SUaDtL/SIM/actions/workflows/ci.yml)

Inventory the services each network domain (for example NIPR, SIPR or DEV) provides and
consumes, who provides and supports them, and see how they connect, including cross-domain
paths through CDS and external SaaS.

SIM is one self-contained HTML file. It has no server, no account and no network access.
Your data lives in a local SQLite (`.sqlite`) file that you open and save yourself.

**Try the main preview: <https://suadtl.github.io/SIM/>** (Edge or Chrome recommended)

## How it works

- **Local-only.** The page makes no network requests after it loads. A Content Security
  Policy (`connect-src 'none'`) forbids them, and the test suite fails on any request that is
  not `file:`. There is no telemetry, update check, CDN or remote font.
- **Your data stays in your file.** SIM reads and writes a `.sqlite` database you choose.
  Nothing is stored in browser storage and nothing is uploaded. Clearing the browser loses
  nothing; a dataset is just a file you keep, back up and share like any other.
- **Chrome and Edge** can open and save the file in place (File System Access API). Other
  browsers fall back to upload and download.
- **Main preview or versioned download.** GitHub Pages follows `main` after CI passes and can
  include changes newer than the latest [release](https://github.com/SUaDtL/SIM/releases).
  Versioned releases are published separately. For an identifiable offline copy, download
  `sim-<version>.html` and its SHA-256 from the chosen release, verify it, and open it from disk.
  Check **About and demo** for the version, commit and build date of the copy you are using.

## Quick start

1. Open the [main preview](https://suadtl.github.io/SIM/) or a downloaded `sim.html`.
2. **File → New** (or try the demo under **About and demo**), then **File → Rename dataset**.
3. **Inventory → Networks → Add network** to choose a network marking such as SEC-REL,
   then use **Services → Add service** to record services and their dependencies.
4. Switch to **Map** to see how they connect; capture it as PNG or SVG.
5. **Save file** (Ctrl+S) to a durable `.sqlite` location. Open it again later with **Open**.

Open **Help** inside the app for a first-map example and vocabulary. The full workflow
reference is in the [user guide](docs/user-guide.md).

## Data handling

SIM is not a classification-aware system and does not guarantee a dataset contains no
sensitive data. Text that looks like an IP address or host name triggers a confirmation
warning, and the banner shows the highest marking present, but you are responsible for what
you enter and where you store the file. Demo and test data are fictional and UNCLASSIFIED.
Opened `.sqlite` files are treated as untrusted and validated (header, application id,
integrity, size cap of 100 MB).

## Build from source

Requires Node 24.

```sh
npm ci
npm run build      # produces dist/sim.html
npm run dev        # Vite dev server for development only
npm run check      # typecheck, lint, format, build, unit and e2e tests
```

`npm run e2e` drives the installed Microsoft Edge and Google Chrome against the built file
from `file://`. See [AGENTS.md](AGENTS.md) for layout, module boundaries and rules, and
[CONTRIBUTING.md](CONTRIBUTING.md) to contribute.

## Releases and hosting

- Every merge to `main` that passes CI is deployed to GitHub Pages by
  [`pages.yml`](.github/workflows/pages.yml). This is a main preview; a merge does not create a
  versioned release. The page footer in **About and demo** shows the version, commit and build date.
- Releases are started by hand from `main` ([`release.yml`](.github/workflows/release.yml)) and
  publish `sim-<version>.html` with its SHA-256. See [CHANGELOG.md](CHANGELOG.md).
- Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Product planning

The [assessment product proposal](docs/assessment-product/README.md) contains a specification,
phased implementation plan, and acceptance protocol for reusable views, assessment handoff,
evidence/questions, owner review, and safe inventory upkeep. It is proposed scope, not a list
of shipped features. Autodiscovery remains deferred.

## License

Apache-2.0. See [LICENSE](LICENSE). Bundled runtime dependencies keep their own licenses,
shown in the app under **About and demo → Licenses and notices**.
