# SIM: Service Integration Map

[![ci](https://github.com/SUaDtL/SIM/actions/workflows/ci.yml/badge.svg)](https://github.com/SUaDtL/SIM/actions/workflows/ci.yml)

Inventory the services each network domain (for example NIPR, SIPR or DEV) provides and
consumes, who provides and supports them, and see how they connect, including cross-domain
paths through CDS and external SaaS.

SIM is one self-contained HTML file. It has no server, no account and no network access.
Your data lives in a local SQLite (`.sqlite`) file that you open and save yourself.

**Use it now: <https://suadtl.github.io/SIM/>** (Edge or Chrome recommended)

## How it works

- **Local-only.** The page makes no network requests after it loads. A Content Security
  Policy (`connect-src 'none'`) forbids them, and the test suite fails on any request that is
  not `file:`. There is no telemetry, update check, CDN or remote font.
- **Your data stays in your file.** SIM reads and writes a `.sqlite` database you choose.
  Nothing is stored in browser storage and nothing is uploaded. Clearing the browser loses
  nothing; a dataset is just a file you keep, back up and share like any other.
- **Chrome and Edge** can open and save the file in place (File System Access API). Other
  browsers fall back to upload and download.
- **Hosted copy or your own copy.** The GitHub Pages site is the same single file that is
  published with each [release](https://github.com/SUaDtL/SIM/releases). For sensitive
  environments, download the release `sim-<version>.html` and its SHA-256, verify it, and open
  it from disk; it behaves identically offline.

## Quick start

1. Open the [hosted app](https://suadtl.github.io/SIM/) or a downloaded `sim.html`.
2. **File → New** (or try the demo under **About and demo**), then **File → Rename dataset**.
3. **Inventory → Services → Add service** to record services and their dependencies.
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
  [`pages.yml`](.github/workflows/pages.yml). The page footer in **About and demo** shows the
  version, commit and build date.
- Releases are started by hand from `main` ([`release.yml`](.github/workflows/release.yml)) and
  publish `sim-<version>.html` with its SHA-256. See [CHANGELOG.md](CHANGELOG.md).
- Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE). Bundled runtime dependencies keep their own licenses,
shown in the app under **About and demo → Licenses and notices**.
