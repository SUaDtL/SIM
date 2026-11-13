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

## Recovery and external file changes

In Chrome or Edge with native file access, **Choose recovery file** enables an optional
separate `.sqlite` snapshot. Choose a location suitable for the dataset's classification.
Applied edits update that file after a short pause; unapplied form text is excluded.
The recovery status reports successful updates or failures independently of Save file.
Use **Retry recovery** after a failure, or choose another file. **Stop recovery** stops
future writes and retains the existing copy. Recovery is off again when you switch datasets
or restart SIM; no file handles or dataset bytes are kept in browser storage.

After a crash, use **Open** to select the recovery `.sqlite` file and **Save As** to retain
the recovered dataset separately. One latest snapshot is retained, without a backup history.
An update already writing when recovery is stopped can finish. Edits made just before a crash
or an interrupted write may be absent. Recovery does not guarantee power-loss durability.

Before a native file write, SIM checks its contents against the opened or last-written bytes.
If another program changed the file, SIM refuses to overwrite it and retains your current work;
use **Save As** to a separate location or reopen the external version. This check is best effort:
another process can still write between the check and commit. SIM does not lock other programs
or merge their changes. The download fallback supports manual copies rather than automatic recovery.

## Development

```sh
npm run check      # typecheck, lint, format, build, unit and e2e tests
```

See [AGENTS.md](AGENTS.md) for all commands, layout and rules, and
[CHANGELOG.md](CHANGELOG.md) for changes.

## License

Apache-2.0. See [LICENSE](LICENSE).
