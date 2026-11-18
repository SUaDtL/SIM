import { button, el, option } from "./dom";
import "./help.css";

interface HelpTopic {
  id: string;
  title: string;
  content: HTMLElement[];
}

function guideTopics(): HelpTopic[] {
  return [
    {
      id: "start",
      title: "Start a real assessment",
      content: [
        el(
          "p",
          { class: "guide-intro" },
          "Inventory the services each network provides, record what they depend on, and make a map for a decision. SIM draws the relationships you enter. Connectivity is not verified.",
        ),
        el("h4", {}, "Name the assessment"),
        el(
          "p",
          {},
          "Choose File → Rename dataset and enter the enterprise name. You can rename the dataset after adding records. Its title and its file name can differ.",
        ),
        el("h4", {}, "Choose a working file"),
        el(
          "p",
          {},
          "Use Save file (Ctrl+S or Command+S) and choose an approved, durable .sqlite location. Save As chooses another file. Reopen your saved file to continue the assessment.",
        ),
        el("h4", {}, "Record what you know"),
        el(
          "p",
          {},
          "Add networks and the services they provide from Inventory. Record established relationships and keep unanswered questions in the assessment notes.",
        ),
      ],
    },
    {
      id: "practice",
      title: "Practice: make your first map",
      content: [
        el(
          "figure",
          { class: "guide-dependency" },
          el(
            "div",
            { class: "guide-route", "aria-hidden": "true" },
            el("div", {}, el("small", {}, "Coral"), el("strong", {}, "Portal")),
            el("span", {}, "→"),
            el("div", {}, el("small", {}, "Amber"), el("strong", {}, "Identity")),
          ),
          el(
            "figcaption",
            {},
            "Portal on Coral depends on Identity on Amber. Read the arrow from the service that needs something to the service that provides it.",
          ),
        ),
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
            "Open Map. Select a service and choose Depends on or Used by. Select a network to explore Network connections. Arrows run from the consuming service to the provider it depends on. Check Filters and hidden-link counts before drawing conclusions.",
          ),
          el(
            "li",
            {},
            "Choose Save file and a temporary .sqlite location. Reopen the file to continue later. Use Capture to share a picture with its scope and classification.",
          ),
        ),
      ],
    },
    {
      id: "demo",
      title: "Explore the fictional demo",
      content: [
        el(
          "p",
          { class: "guide-intro" },
          "Choose Open demo at the top of this guide to explore a fictional enterprise. You can also choose Explore fictional demo from a new workspace.",
        ),
        el("h4", {}, "Find a record"),
        el(
          "p",
          {},
          "Use Find anything (Ctrl+K or Command+K) to search by name. Use the network and record type to distinguish results with similar names. Choose a result to open its inspection panel.",
        ),
        el("h4", {}, "Follow a dependency"),
        el(
          "p",
          {},
          "On the map, select a service and choose Depends on for its providers or Used by for its consumers. Back from focus restores your previous map view.",
        ),
        el("h4", {}, "Try the planning proposal"),
        el(
          "p",
          {},
          "On Map, change View from As-Is to To-Be: Shared planning hub. Find Planning Hub on Operations. Choose Compare to see the new service and the two services it would replace.",
        ),
      ],
    },
    {
      id: "save",
      title: "Apply, save and recover",
      content: [
        el("h4", {}, "Service drafts"),
        el(
          "p",
          {},
          "Add creates a record. For an existing service, Apply changes records its details, connections and support together as one undo step. Finish adding or cancel any open connection task first. Discard changes restores its draft.",
        ),
        el("h4", {}, "Scenario changes"),
        el(
          "p",
          {},
          "In a scenario, Add change and Remove take effect immediately; Undo reverses them. Apply changes records the scenario name, description and a fully specified unadded proposal. Discard changes resets only work not yet applied. It does not reverse changes you already added or removed.",
        ),
        el("h4", {}, "Save to a file"),
        el(
          "p",
          {},
          "Save file applies a valid active draft before saving it to disk. Invalid, unfinished or unconfirmed input stops the save. Saved means the active file write completed. Download requested means the browser received the download. Check the downloaded file. Cancelling a picker keeps your work.",
        ),
        el("h4", {}, "Recovery and upgrades"),
        el(
          "p",
          {},
          "Choose a separate recovery .sqlite file from File. It keeps the latest applied snapshot, not unapplied form text, and retains the dataset's classification. Reopen that file after an interrupted session. Continue saving your working file normally. An interrupted disk write can leave an incomplete recovery file.",
        ),
        el(
          "p",
          {},
          "Keep an untouched copy before saving a dataset upgrade. An older SIM build needs the pre-upgrade copy.",
        ),
      ],
    },
    {
      id: "review",
      title: "Share and review an assessment",
      content: [
        el("h4", {}, "Scope, evidence and questions"),
        el(
          "p",
          {},
          "Use File → Assessment details to enter optional scope and dates. Open Evidence and questions from a service overview to inspect its recorded sources and open questions.",
        ),
        el("h4", {}, "Prepare a briefing"),
        el(
          "p",
          {},
          "Saved views reopen over current records. Export a scoped report or inventory from File and verify its marking and scope before sharing.",
        ),
        el("h4", {}, "Review corrections"),
        el(
          "p",
          {},
          "Prepare owner review saves a team’s base in the dataset. If SIM downloads the dataset, reopen the downloaded file before exporting the review. Apply reviewed corrections shows the exact returned fields so you can decide what to record.",
        ),
      ],
    },
    {
      id: "vocabulary",
      title: "Map vocabulary",
      content: [
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
            "A recorded cross-domain solution between networks. A missing CDS leaves the route uncertain. Crossing another network box does not imply transit through that network.",
          ),
          el("dt", {}, "Foundational service"),
          el(
            "dd",
            {},
            "A shared underlying capability. Links to these services are hidden by default to reduce clutter. The scope disclosure counts the omitted links.",
          ),
          el("dt", {}, "As-Is / To-Be / Compare"),
          el(
            "dd",
            {},
            "As-Is is the current recorded enterprise, including applied changes not yet saved to file. To-Be applies a proposed scenario to that baseline. Compare shows their differences. Projected records are read-only until you deliberately open the baseline editor.",
          ),
        ),
      ],
    },
    {
      id: "files",
      title: "Your files and classification",
      content: [
        el("h4", {}, "Local files"),
        el(
          "p",
          {},
          "SIM runs offline from this HTML. It does not discover networks, upload data or store datasets in browser storage. Your .sqlite files are ordinary local files and require an approved storage location.",
        ),
        el("h4", {}, "Markings and caveats"),
        el(
          "p",
          {},
          "The banner and exports show the highest marking anywhere in the dataset, including in a filtered view. Keep real host names and IP addresses out. Input warnings cannot establish classification. SIM does not encrypt the dataset.",
        ),
      ],
    },
  ];
}

/** Bundled task guidance. Opening help preserves the active draft. */
export function openHelp(actions: { demo(): void; licenses(origin: HTMLElement): void }): void {
  const origin = document.activeElement;
  const heading = el("h2", { id: "help-title", tabindex: "-1", autofocus: "" }, "Using SIM");
  const dialog = el("dialog", { class: "help-dialog", "aria-labelledby": heading.id });
  const topics = guideTopics();
  const index = el("nav", { class: "guide-index", "aria-label": "Help topics" }, el("h3", {}, "Topics"));
  const select = el("select", { id: "guide-topic" });
  const compactIndex = el("div", { class: "guide-choose" }, el("label", { for: select.id }, "Topic"), select);
  const reader = el("div", { class: "guide-reader", role: "region", "aria-label": "Guide article", tabindex: "0" });
  const entries = topics.map((topic) => {
    const title = el("h3", { id: `guide-${topic.id}`, tabindex: "-1" }, topic.title);
    const section = el("section", { "aria-labelledby": title.id }, title, ...topic.content);
    const link = button(topic.title, () => {
      selectTopic(topic.id);
      title.focus({ preventScroll: true });
    });
    index.append(link);
    select.append(option(topic.id, topic.title));
    reader.append(section);
    return { id: topic.id, link, section };
  });

  function selectTopic(id: string): void {
    for (const entry of entries) {
      const active = entry.id === id;
      entry.section.hidden = !active;
      if (active) entry.link.setAttribute("aria-current", "page");
      else entry.link.removeAttribute("aria-current");
    }
    select.value = id;
    reader.scrollTop = 0;
  }
  select.addEventListener("change", () => {
    selectTopic(select.value);
  });
  selectTopic("start");

  function close(): void {
    dialog.close();
  }
  const notices = button("Licenses and notices", () => {
    actions.licenses(notices);
  });
  dialog.append(
    el(
      "header",
      { class: "guide-header" },
      heading,
      button("Open demo", () => {
        close();
        actions.demo();
      }),
      button("Close Help", close, { class: "guide-close" }),
    ),
    compactIndex,
    el("div", { class: "guide-body" }, index, reader),
    el("footer", { class: "guide-footer" }, notices),
  );
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      if (origin instanceof HTMLElement && origin.isConnected && !document.querySelector("dialog[open]"))
        origin.focus({ preventScroll: true });
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  heading.focus({ preventScroll: true });
}
