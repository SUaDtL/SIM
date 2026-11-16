import { button, el } from "./dom";

/** Bundled task guidance. Opening help never resolves or changes an active draft. */
export function openHelp(actions: { demo(): void; licenses(): void }): void {
  const origin = document.activeElement;
  const heading = el("h2", { id: "help-title", tabindex: "-1", autofocus: "" }, "Using SIM");
  const dialog = el(
    "dialog",
    { class: "help-dialog", "aria-labelledby": "help-title" },
    heading,
    el(
      "p",
      { class: "help-intro" },
      "Inventory the services each network provides, record what they depend on, and make a map for a decision. SIM draws the relationships you enter; connectivity is not verified.",
    ),
    el("h3", {}, "Start a real assessment"),
    el(
      "p",
      {},
      "Use File → Rename dataset to name your enterprise, including after adding records. Use Save file (Ctrl+S or Command+S) and choose an approved, durable .sqlite location. The document title and file name are separate; Save As chooses another file. Record only the relationships you have established and keep unanswered questions in your assessment notes.",
    ),
    el("h3", {}, "Practice: make your first map"),
    el(
      "ol",
      {},
      el(
        "li",
        {},
        "Add two fictional networks, such as Coral and Amber. A network is a domain that contains services.",
      ),
      el("li", {}, "Add Portal on Coral and Identity on Amber. A service is a capability that a network provides."),
      el(
        "li",
        {},
        "Edit Portal. In Connections, record its explicit dependency on Identity. Choose a CDS only when a cross-domain solution is recorded for that route. Apply changes.",
      ),
      el(
        "li",
        {},
        "Open Map and ask Depends on, Used by, or Network connections. Arrows run from the consuming service to the provider it depends on. Check Filters and hidden-link counts before drawing conclusions.",
      ),
      el(
        "li",
        {},
        "Choose Save file and a temporary .sqlite location. Reopen the file to continue later. Use Capture to give a colleague a picture with its scope and classification.",
      ),
    ),
    el("h3", {}, "Try the fictional demo"),
    el(
      "p",
      {},
      "Start with a service, ask what it depends on, then inspect a connection. Compare a scenario with As-Is before editing the baseline. The demo is fictional and UNCLASSIFIED.",
    ),
    button("Open demo", () => {
      close();
      actions.demo();
    }),
    el("h3", {}, "Apply, save and recover"),
    el(
      "p",
      {},
      "Add creates a record. For an existing service, Apply changes records its details, connections and support together as one undo step. Finish adding or cancel any open connection task first. Discard changes restores its draft. Save file applies a valid active draft before saving it to disk. Invalid, unfinished or unconfirmed input stops the save.",
    ),
    el(
      "p",
      {},
      "In a scenario, Add change and Remove take effect immediately; Undo reverses them. Apply changes records the scenario name, description and a fully specified unadded proposal. Discard changes resets only work not yet applied. It does not reverse changes you already added or removed.",
    ),
    el(
      "p",
      {},
      "Saved means the active file write completed. In the download fallback, Download requested means a download was handed to the browser; check the downloaded file. Save As chooses another file. Cancelling a picker keeps your work.",
    ),
    el(
      "p",
      {},
      "Recovery is optional: choose a separate recovery .sqlite file from File. It keeps the latest applied snapshot, not unapplied form text, and retains the dataset's classification. Reopen that file after an interrupted session. Recovery does not replace normal saves or guarantee survival of an interrupted disk write.",
    ),
    el("h3", {}, "Map vocabulary"),
    el(
      "dl",
      {},
      el("dt", {}, "Dependency"),
      el(
        "dd",
        {},
        "An explicit consuming service → providing service relationship. A consuming organization is a separate inventory relationship.",
      ),
      el("dt", {}, "CDS"),
      el(
        "dd",
        {},
        "A recorded cross-domain solution between networks. No CDS recorded is uncertainty about the route, not proof of direct connectivity.",
      ),
      el("dt", {}, "Foundational service"),
      el(
        "dd",
        {},
        "A shared underlying capability. Links to these services are hidden by default to reduce clutter; the scope disclosure counts the omitted links.",
      ),
      el("dt", {}, "As-Is / To-Be / Compare"),
      el(
        "dd",
        {},
        "As-Is is the current recorded enterprise, including applied changes not yet saved to file. To-Be applies a proposed scenario to that current baseline; Compare shows their differences. File saving is separate. Projected records are read-only until you deliberately open the baseline editor.",
      ),
    ),
    el(
      "p",
      {},
      "Map lines show recorded dependencies between their endpoints. A line crossing another network box does not imply transit through that network. Layout avoids some obstacles; it does not validate network reachability.",
    ),
    el("h3", {}, "Your files and classification"),
    el(
      "p",
      {},
      "SIM runs offline from this HTML. It does not discover networks, upload data, or store datasets in browser storage. Your .sqlite files are ordinary local files, not encrypted vaults. Keep real host names and IP addresses out; a warning is not a classification guarantee. The banner and exports show the highest marking anywhere in the dataset, even in a filtered view.",
    ),
    el(
      "div",
      { class: "actions" },
      button("Licenses and notices", () => {
        close();
        actions.licenses();
      }),
      button("Close Help", close, { class: "primary" }),
    ),
  );
  function close(): void {
    dialog.close();
  }
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  heading.focus({ preventScroll: true });
  dialog.scrollTop = 0;
}
