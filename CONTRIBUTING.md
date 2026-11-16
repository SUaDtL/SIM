# Contributing

Thanks for helping with SIM. Read [AGENTS.md](AGENTS.md) first: it covers commands, layout,
module boundaries and the rules (no network, no prohibited primitives, fictional data only).

1. Fork and branch from `main`; `main` changes only through pull requests.
2. `npm ci`, then make your change with tests.
3. Run `npm run check` (typecheck, lint, format, build, unit and e2e tests) before opening a PR.
4. Add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

Use only synthetic, UNCLASSIFIED data in fixtures, screenshots and issues. Never post real
network details, customer data or classified material. Schema changes need a new forward-only
migration; never edit a merged one.
