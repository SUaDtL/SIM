# SIM: Service Integration Map

Inventory the services each network domain (e.g. NIPR, SIPR, DEV) provides and consumes,
who provides and supports them, and see how they connect, including cross-domain paths
through CDS and external SaaS. SIM is one HTML file that runs offline in Edge or Chrome
straight from disk; your data lives in a local `.sqlite` file.

## Quick start

```sh
npm install
npm run build      # produces dist/sim.html
```

Open `dist/sim.html` in Edge or Chrome by double-clicking it. No server or internet needed.

## Development

```sh
npm run check      # typecheck, lint, format, build, unit and e2e tests
```

See [AGENTS.md](AGENTS.md) for all commands, layout and rules, and
[CHANGELOG.md](CHANGELOG.md) for changes.

## License

Apache-2.0. See [LICENSE](LICENSE).
