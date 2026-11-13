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

## Add and connect services

Choose **Services** in the list, then **Add service**, even in an empty dataset.
Use **Create network**, or the Create controls beside other references, to create and
select a missing record without losing the service form. The child dialog is one level
deep. Cancel or Escape leaves the parent intact. An explicitly created shared record
has its own Undo step and remains if you later cancel the service.

Stage support assignments, consuming organizations and outgoing service dependencies
alongside the service fields. **Add service** creates the initial aggregate in one step;
**Apply changes** updates an existing aggregate in one step. **Discard changes** restores
the existing service. Save file applies a valid active draft before writing the file.
Host-like text requires confirmation of the exact current payload; editing it withdraws
the old acknowledgement.

Outgoing dependencies describe what this service needs. Incoming dependencies belong to
their consuming service; use **Edit incoming dependency** to navigate to that owner.
Organizational consumption is separate. **Edit route** changes a staged dependency
without removing it first. A cross-network connection may have no CDS; selecting a CDS
requires it to join both endpoints' networks. Rehoming services validates the resulting
incoming and outgoing routes. Existing legacy issues are retained until explicitly repaired.

## Find, inspect and return

**Find on map** offers partial, case-insensitive results with record type and network
or scenario identity. Use the explicit result buttons to distinguish matching names.
Reference inspection opens a read-only peek without applying the parent draft. Reverse
relations show recorded provider, support, consumer, application, category and route roles.
**Open for editing** follows a reference through the unapplied-work decision.
**Back** restores navigation context, including filters and framing; Undo changes data.
Choosing Stay leaves the current task intact.

To-Be and Compare inspectors retain their projected origin and are read-only.
**Edit As-Is** reveals the real baseline service. Changing View or removing a planned
origin closes stale projected inspection. Connection rows and map route segments open
the same connection inspector, including unresolved-route provenance.

## Ask a map question and capture it

Select a service and use **Depends on** or **Used by** for direct providers or consumers.
**Expand focus** follows another hop in the chosen direction. Select a network and use
**Network connections** to keep complete boundary routes and their remote endpoints.
Focus temporarily suspends inventory filters; **Back** restores them and the prior framing.
Focus, Fit and Back do not change saved node positions or create Undo steps.

**Export PNG** and **Export SVG** capture the current view with scope, legend and the
full dataset or projection marking, including higher classifications outside the focus.
With an unapplied draft, choose **Capture current view**, **Apply and capture**, or Cancel.
An export failure after Apply retains the applied change and its Undo step.
The visible export status reports progress, cancellation or failure. At laptop sizes,
**Focus editor** gives the active form more room; **Show full workspace** restores the map.

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
