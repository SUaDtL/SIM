# SIM user guide

Detailed workflows for the Service Integration Map. For an overview see the [README](../README.md).

## Qualify an assessment and hand it off

**Assessment → Assessment details** records optional scope, exclusions, assessor/team and dates
under the dataset title. **Assessment → Evidence and questions** records optional
findings, sources and follow-up actions. A service’s **More service actions → Assessment notes** opens its linked notes. Questions can be attached later. When a linked
record disappears, its notes retain the former link and stay visible. Evidence reviewed
against an earlier value returns to needs review when the value changes.

**Assessment → Saved views** stores the current question, filters, selected projection and framing.
A saved view opens over current records and positions. If its subject or scope has
disappeared, edit the definition to replace it with the current map. Saving a definition
is undoable and takes effect on disk after Save file.

**Assessment → Export assessment or inventory** creates read-only HTML, typed inventory JSON or a
display CSV. Open Map for the current map scope and a frozen capture. A focused export
omits assessment-level details and uses the full original handling marking and caveat.
Review the scope before distributing it. JSON preserves exact values. The display CSV
protects values that may be interpreted as formulas and should be used for reading.

**Assessment → Decision views** shows a network dependency matrix, responsibility roles and bounded
dependency paths. A zero count means no dependencies were recorded in that scope.
From **Inventory → Assessment → Batch assignments**, select services across pages, review the exact
changes and apply them in one Undo step. **Create and use** saves a shared record before the batch preview. Assigning an existing organization updates
the selected services without renaming the organization. **Review data issues** also
provides optional duplicate suggestions with each shared record's usage.

**Assessment → Prepare owner review** previews the organization scope and saves its issuance
base. If the browser downloads files instead of saving in place, reopen the resulting
dataset before downloading the review. Reviewers put typed proposals in the downloaded
JSON. **Apply reviewed corrections** shows the issued, current and proposed values,
including conflicts. Select only the fields to apply. The existing CSV import continues
to add new rows. Review receipts describe what happened when applied and stay historical
after Undo or another edit. Use **Assessment → Download latest correction receipt** until you switch datasets.

Files saved by this build use data format 7. Keep an untouched copy before saving an
upgrade. To open the data in an older build, use the pre-upgrade copy.

## Add and connect services

Open **Inventory**, choose **Services**, then **Add service**, even in an empty dataset.
Select an existing record to read its summary; choose **Edit** (or F2) to change it.
In a reference field, use **Choose** to search qualified records or create and use a
missing record without losing the service form. The child dialog is one level
deep. Cancel or Escape leaves the parent intact. An explicitly created shared record
has its own Undo step and remains if you later cancel the service.

Stage support assignments, consuming organizations and outgoing service dependencies
alongside the service fields. **Add service** creates the initial aggregate in one step;
**Apply changes** updates an existing aggregate in one step. **Discard changes** restores
the existing service. Save file applies a valid active draft before writing the file.
Details, Connections and Support share that same draft. Apply reveals errors in the
relevant section. Cancel follows the unapplied-work decision before returning to inspection.
The editor keeps the record name and network visible on every tab, including the source
and destination context when creating a similar service. Projected summaries distinguish
outgoing dependencies from incoming **Used by** service counts.
Host-like text requires confirmation of the exact current payload; editing it withdraws
the old acknowledgement.

Finish adding or explicitly cancel each open consumer, dependency or route task before
Apply or Save. These operations retain unfinished input and focus its completion action.
Inspecting a staged connection shows its pending state; it does not read back an older saved route.
As-Is means the current recorded enterprise, including applied edits not yet saved to file.
File status describes whether that current state has reached the chosen file.

Outgoing dependencies describe what this service needs. Incoming dependencies belong to
their consuming service; use **Edit incoming dependency** to navigate to that owner.
Organizational consumption is separate. **Edit route** changes a staged dependency
without removing it first. A cross-network connection may have no CDS; selecting a CDS
requires it to join both endpoints' networks. Rehoming services validates the resulting
incoming and outgoing routes. Existing legacy issues are retained until explicitly repaired.
**Assessment → Review data issues** keeps the complete paginated issue list available after other edits,
with links to the affected records. Opening a file or reviewing its issues does not repair it.

**Create similar service** starts an independent draft from the selected service;
**Start from an existing service** offers the same choice within Add. Choose the destination
network explicitly. Descriptive fields, classification, foundational flag and shared
references are prefilled. Support assignments and notes are copied only if selected.
Consumers, dependency routes and positions are not copied; the source remains unchanged.

## Find, inspect and return

**Find on map** offers partial, case-insensitive results with record type and network
or scenario identity. Use the explicit result buttons to distinguish matching names.
Reference inspection uses the same contextual inspector and preserves a parked parent draft. Back restores the invoking record and control. Reverse
relations show recorded provider, support, consumer, application, category and route roles.
**Edit** in the inspector follows a reference through the unapplied-work decision.
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

**Capture** saves a PNG directly; **Capture options → Export SVG** saves a vector image.
Both capture the current view with scope, legend and the
full dataset or projection marking, including higher classifications outside the focus.
The visible legend explains consumer-to-provider arrows and unverified connectivity.
Scope disclosure counts hidden foundational dependencies and names active filters/focus;
detached captures retain those omissions, the current-viewport boundary and the same caveat.
Display-only curve offsets reduce links crossing unrelated nodes or labels without changing
recorded endpoints or saved positions. This is bounded avoidance, not a complete obstacle router.
Caption and classification sizes account for map height and wrapping, targeting readable
annotations when the whole capture fits a 1280×720 slide. Check your actual presentation or
print size; this does not guarantee human readability of every map label.
With an unapplied draft, choose **Capture current view**, **Apply and capture**, or Cancel.
An export failure after Apply retains the applied change and its Undo step.
The visible export status reports progress, cancellation or failure. Inventory and Map
are separate workspaces. Switching between them retains the editor draft; **Return to draft**
restores it. Fit changes framing; **Layout → Re-layout** changes saved positions with Undo.

**File** contains New, Open, Save As, CSV import, banner caveat and recovery controls.
Save file, Undo/Redo and document/recovery status remain visible. **About** contains the
SQLite version and fictional demo. Inventory, relationship and picker results have bounded
pages, counts and local search. At very short zoomed viewports the page scrolls to the editor;
the classification banners remain visible and the editor keeps its own scroll body.

## Reconcile CSV imports

**File → Import CSV** previews additions, already-present rows and rejected or host-like rows.
Diagnostics use bounded pages so every row remains reachable. **Download preview receipt**
retains the complete file/row/reason report, including files that could not be read.
After importing, reopen Import CSV and expand **Last import receipt** to review or download
the most recent completed import. Choose corrected files for another preview and retry.
Cancelling a preview leaves that completed receipt intact. It describes the completed import
even if you later Undo it; it is not a live count of the current dataset.

Receipts stay in memory for the originating dataset session and clear on New/Open/demo or restart.
Downloads include source and classification metadata, including higher recognized incoming
markings on rejected rows; unreadable or unrecognized input cannot be fully assessed.
Handle source CSV and diagnostics according to their actual classification. Warning notes
are not extra imported rows, and additions count records/links rather than guaranteed whole-row successes.

## Recovery and external file changes

In Chrome or Edge with native file access, **File → Choose recovery file** enables an optional
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
Files over the 100 MiB dataset limit are refused before reading their bytes, including
Open, existing Save As targets and externally enlarged files checked before overwrite.
If another program changed the file, SIM refuses to overwrite it and retains your current work;
use **Save As** to a separate location or reopen the external version. This check is best effort:
another process can still write between the check and commit. SIM does not lock other programs
or merge their changes. The download fallback supports manual copies rather than automatic recovery.
