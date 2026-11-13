import type { Repository } from "../domain/repository";
import { downloadBlob, suggestedImageName } from "../file/dataset-file";
import { createMapView, type MapViewState, type MapViewContext } from "../map/map-view";
import { button, el } from "./dom";
import { createEditor } from "./editor-panel";
import { createListPanel, type ListPanel, type Selection } from "./list-panel";
import { descriptor } from "./forms";
import { relatedEntities, type EntityTarget } from "./relations";
import { dependencyKey, serviceOrigin, type ProjectedSnapshot } from "../scenario/scenario";

export interface Workspace {
  readonly element: HTMLElement;
  /** Show a (new or reopened) dataset: drops the old selection and listens to the new repository. */
  setRepository(repo: Repository): void;
  /** Undo or redo ran: forms showing changed data are rebuilt. */
  historyChanged(): void;
  hasPendingDraft(): boolean;
  pendingDraftLabel(): string;
  applyActiveDraft(): boolean;
  discardActiveDraft(): void;
  resolveActiveDraft(kind: "navigate" | "history" | "import" | "capture"): Promise<boolean>;
  sessionIdentity(): number;
  activeDraftToken(): number;
  settlePendingPlacement(): Promise<void>;
}

/** The three-region layout: entity list (left), map area (center), editor (right). */
export function createWorkspace(
  initial: Repository,
  onDraftChanged: () => void = () => undefined,
  captureUnsaved: () => boolean = () => true,
): Workspace {
  let repo = initial;
  let unsubscribe = (): void => undefined;
  let sessionId = 0;
  let draftToken = 0;
  type NavigationEntry = {
    selection: Selection | null;
    map: MapViewState;
    list: ReturnType<ListPanel["viewContext"]>;
    focus: HTMLElement | null;
    focusBookmark: { scope: HTMLElement; index: number; id: string; tag: string; text: string } | null;
    origin: Parameters<typeof editor.inspectProjected>[0]["data"]["origin"] | null;
  };
  const navigationHistory: NavigationEntry[] = [];
  let pendingReturn: NavigationEntry | null = null;
  let navigationRequest = 0;
  let mapNavigation = false;
  let inspectConnection: NonNullable<MapViewContext["inspectDependency"]> = () => undefined;
  let projectedOrigin: Parameters<typeof editor.inspectProjected>[0]["data"]["origin"] | null = null;
  let restoringOrigin = false;
  const navigationStatus = el("p", { role: "status", "data-testid": "navigation-status" });
  const backButton = button("Back", () => {
    void back();
  });
  backButton.disabled = true;

  function captureNavigation(): NavigationEntry {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scope = [editor.element, list.element, map.element].find((region) => active && region.contains(active));
    return {
      selection: editor.selection(),
      map: map.captureView(),
      list: list.viewContext(),
      focus: active,
      focusBookmark:
        active && scope
          ? {
              scope,
              index: [
                ...scope.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]"),
              ].indexOf(active),
              id: active.id,
              tag: active.tagName,
              text: active.textContent,
            }
          : null,
      origin: projectedOrigin,
    };
  }

  function restoreNavigationFocus(entry: NavigationEntry): void {
    if (entry.focus?.isConnected) {
      entry.focus.focus({ preventScroll: true });
      return;
    }
    // Editors and list rows are rebuilt on return. Resolve the original control within its
    // retained region, rather than attempting to focus the detached previous DOM node.
    const bookmark = entry.focusBookmark;
    if (!bookmark?.scope.isConnected) return;
    const controls = [
      ...bookmark.scope.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]"),
    ];
    const target = bookmark.id ? controls.find((node) => node.id === bookmark.id) : controls[bookmark.index];
    if (target?.tagName === bookmark.tag && target.textContent === bookmark.text) {
      target.focus({ preventScroll: true });
    }
  }

  async function prepareNavigation(): Promise<boolean> {
    const before = captureNavigation();
    const request = ++navigationRequest;
    const session = sessionId;
    if (!(await resolveActiveDraft("navigate")) || request !== navigationRequest || session !== sessionId) {
      restoreNavigationFocus(before);
      return false;
    }
    pendingReturn = before;
    return true;
  }

  function rememberReturn(): void {
    const before = pendingReturn ?? captureNavigation();
    pendingReturn = null;
    navigationHistory.push(before);
    if (navigationHistory.length > 64) navigationHistory.shift();
    backButton.disabled = false;
  }

  async function back(): Promise<void> {
    const previous = navigationHistory.at(-1);
    const session = sessionId;
    const request = ++navigationRequest;
    if (!previous || !(await resolveActiveDraft("navigate"))) return;
    if (session !== sessionId || request !== navigationRequest || navigationHistory.at(-1) !== previous) return;
    navigationHistory.pop();
    projectedOrigin = null;
    pendingReturn = null;
    if (
      previous.selection &&
      (previous.selection.id === null ||
        descriptor(previous.selection.type).get(repo, previous.selection.id) !== undefined)
    ) {
      editor.open(previous.selection.type, previous.selection.id);
    } else {
      editor.close();
      navigationStatus.textContent = previous.selection
        ? "The previous record no longer exists."
        : "Returned to the workspace.";
    }
    map.restoreView(previous.map);
    if (previous.origin) {
      restoringOrigin = true;
      if (!map.inspectOrigin(previous.origin)) {
        restoringOrigin = false;
        navigationStatus.textContent = "The previous projected target is no longer available.";
      }
    }
    list.restoreContext(previous.list);
    restoreNavigationFocus(previous);
    backButton.disabled = navigationHistory.length === 0;
  }

  function peek(target: EntityTarget): void {
    const focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = el("dialog", { "aria-label": "Inspect related record" });
    const close = (): void => {
      dialog.close();
      dialog.remove();
      focusBefore?.focus();
    };
    function draw(next: EntityTarget): void {
      const d = descriptor(next.type);
      const record = d.get(repo, next.id);
      if (record === undefined) {
        dialog.replaceChildren(el("p", {}, "This record no longer exists."), button("Close", close));
        return;
      }
      const values = d.values(repo, next.id);
      dialog.replaceChildren(
        el("h2", { tabindex: "-1" }, `${d.label}: ${String(values["name"] ?? "")}`),
        ...d.fields.map((field) => el("p", {}, `${field.label}: ${String(values[field.key] ?? "")}`)),
        ...relatedEntities(repo.snapshot(), next).map((row) =>
          button(`${row.label}: ${row.detail}`, () => {
            draw(row.target);
          }),
        ),
        button("Open for editing", () => {
          close();
          void open(next.type, next.id);
        }),
        button("Close", close),
      );
      if (dialog.open) dialog.querySelector<HTMLElement>("h2")?.focus();
    }
    draw(target);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    document.body.append(dialog);
    dialog.showModal();
  }

  function chooseDraftAction(
    kind: "navigate" | "history" | "import" | "capture",
  ): Promise<"apply" | "discard" | "stay"> {
    return new Promise((resolve) => {
      const dialog = el("dialog", { "aria-label": "Unapplied changes" });
      const title =
        kind === "capture"
          ? `Capture the current map? ${editor.pendingDraftLabel()} is pending.`
          : `${editor.pendingDraftLabel()} is pending. Choose how to continue.`;
      const choices: readonly [string, "apply" | "discard" | "stay"][] =
        kind === "history"
          ? [
              ["Discard draft and continue", "discard"],
              ["Keep editing", "stay"],
            ]
          : kind === "capture"
            ? [
                ["Apply and capture", "apply"],
                ["Capture current view", "discard"],
                ["Cancel", "stay"],
              ]
            : [
                ["Apply and continue", "apply"],
                ["Discard and continue", "discard"],
                ["Stay", "stay"],
              ];
      const settle = (choice: "apply" | "discard" | "stay"): void => {
        dialog.close();
        dialog.remove();
        resolve(choice);
      };
      dialog.append(
        el("p", {}, title),
        ...choices.map(([label, choice]) => {
          const control = el("button", { type: "button" }, label);
          control.addEventListener("click", () => {
            settle(choice);
          });
          return control;
        }),
      );
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        settle("stay");
      });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  async function resolveActiveDraft(kind: "navigate" | "history" | "import" | "capture"): Promise<boolean> {
    if (!editor.hasPendingDraft()) return true;
    const owner = repo;
    const session = sessionId;
    const token = draftToken;
    const choice = await chooseDraftAction(kind);
    if (repo !== owner || sessionId !== session || draftToken !== token) return false;
    if (choice === "stay") return false;
    if (choice === "apply") {
      if (!editor.applyActiveDraft()) return false;
      if (kind === "capture") await map.settlePendingPlacement();
      return true;
    }
    if (kind !== "capture") editor.discardActiveDraft();
    return true;
  }

  async function open(type: Parameters<typeof editor.open>[0], id: number | null): Promise<void> {
    if (editor.selection()?.type === type && editor.selection()?.id === id && !projectedOrigin) {
      pendingReturn = null;
      mapNavigation = false;
      return;
    }
    if (!pendingReturn && !(await prepareNavigation())) return;
    if (id !== null && descriptor(type).get(repo, id) === undefined) {
      pendingReturn = null;
      mapNavigation = false;
      navigationStatus.textContent = "That record no longer exists. Choose another result.";
      return;
    }
    const mapAlreadyRevealed = mapNavigation;
    mapNavigation = false;
    rememberReturn();
    projectedOrigin = null;
    editor.open(type, id);
    navigationStatus.textContent = "";
    list.reveal(type);
    if (!mapAlreadyRevealed && id !== null && ["service", "network", "cds"].includes(type))
      map.reveal(type as "service" | "network" | "cds", id);
  }

  const editor = createEditor({
    repo: () => repo,
    selectionChanged: () => {
      list.render();
    },
    draftChanged: () => {
      draftToken++;
      onDraftChanged();
    },
    requestServiceOnNetwork: (networkId) => {
      void (async () => {
        if (await resolveActiveDraft("navigate")) editor.openServiceOnNetwork(networkId);
      })();
    },
    requestNavigate: (target, intent) => {
      if (intent === "peek") peek(target);
      else void open(target.type, target.id);
    },
    requestDependency: (consumer, provider) => {
      inspectConnection(consumer, provider, repo.snapshot(), false);
    },
  });
  const list = createListPanel({
    repo: () => repo,
    selection: () => editor.selection(),
    select: (type, id) => {
      void open(type, id);
    },
  });
  const map = createMapView({
    snapshot: () => repo.snapshot(),
    resolveNavigation: async () => {
      const accepted = await prepareNavigation();
      mapNavigation = accepted;
      return accepted;
    },
    navigationAborted: () => {
      pendingReturn = null;
      mapNavigation = false;
    },
    projectionChanged: () => {
      if (projectedOrigin) {
        editor.close();
        projectedOrigin = null;
        navigationStatus.textContent = "Projection changed. Select a record in the current view.";
      }
    },
    inspectDependency: (inspectConnection = (consumer, provider, projected, readOnly) => {
      const row = projected.dependencies.find(
        (d) => d.consumerServiceId === consumer && d.providerServiceId === provider,
      );
      if (!row) return;
      const provenance =
        "projection" in projected
          ? (projected as ProjectedSnapshot).projection.dependencyProvenance.get(dependencyKey(row))
          : undefined;
      const projection = "projection" in projected ? (projected as ProjectedSnapshot).projection : null;
      const scenario = projected.scenarios.find((item) => item.id === projection?.scenarioId);
      const originDescription = (id: number): string => {
        const origin = serviceOrigin(projected, id);
        return origin.kind === "planned"
          ? `Planned in ${scenario?.name ?? "this scenario"}, change #${String(origin.changeId)}`
          : `As-Is service #${String(origin.serviceId)}`;
      };
      const qualify = (id: number): string => {
        const s = projected.services.find((item) => item.id === id);
        return `${s?.name ?? "Unavailable"} (${projected.networks.find((n) => n.id === s?.networkId)?.name ?? "Unknown network"})`;
      };
      const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const dialog = el("dialog", { "aria-label": "Connection inspector" });
      const close = (): void => {
        dialog.close();
        dialog.remove();
        before?.focus();
      };
      dialog.append(
        el("h2", {}, "Recorded dependency"),
        el("p", {}, `${qualify(consumer)} → ${qualify(provider)}`),
        ...(readOnly
          ? [
              el(
                "p",
                {},
                `Projection: ${scenario?.name ?? "current scenario"}. Consumer origin: ${originDescription(consumer)}. Provider origin: ${originDescription(provider)}.`,
              ),
            ]
          : []),
        el(
          "p",
          {},
          provenance?.status === "unresolved"
            ? `Unresolved route previously via ${provenance.previousViaCdsIds.map((id) => projected.cds.find((cds) => cds.id === id)?.name ?? String(id)).join(", ") || "a CDS"}: ${provenance.reason ?? "coverage changed"}. Connectivity is unverified.`
            : row.viaCdsId === null
              ? "No CDS recorded. This does not verify direct connectivity."
              : `Via CDS: ${projected.cds.find((item) => item.id === row.viaCdsId)?.name ?? "Unavailable"}`,
        ),
        readOnly
          ? el("p", {}, "Projected connection, read-only. Edit its originating scenario to change the projection.")
          : button("Edit consuming service", () => {
              close();
              void open("service", consumer);
            }),
        button("Close", close),
      );
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        close();
      });
      document.body.append(dialog);
      dialog.showModal();
    }),
    resolveCapture: async () => ((await resolveActiveDraft("capture")) ? "capture" : "cancel"),
    captureSource: () => ({
      sessionId,
      name: repo.datasetName(),
      revision: repo.currentRevision(),
      unsaved: captureUnsaved(),
    }),
    savePositions: (positions, history, origin?: { sessionId: number; revision: number }) => {
      if (origin && (origin.sessionId !== sessionId || origin.revision !== repo.currentRevision())) return;
      repo.setPositions(positions, history);
    },
    saveImage: (image, extension, capturedName) => {
      downloadBlob(image, suggestedImageName(capturedName, extension));
    },
    open: (type, id) => {
      void open(type, id);
    },
    openScenario: (id) => {
      void open("scenario", id);
    },
    inspectNode: (node, view, projected, comparison) => {
      void (async () => {
        const restoring = restoringOrigin;
        restoringOrigin = false;
        const before = repo.currentRevision();
        if (!restoring && !pendingReturn && !(await prepareNavigation())) return;
        if (repo.currentRevision() !== before) {
          map.refresh();
          if (!map.inspectOrigin(node.data.origin)) editor.close();
          return;
        }
        mapNavigation = false;
        if (!restoring) rememberReturn();
        projectedOrigin = node.data.origin;
        navigationStatus.textContent = "";
        list.reveal(node.data.entity);
        editor.inspectProjected(node, view, projected, comparison, {
          editAsIs: (entity, id) => {
            void (async () => {
              if (!(await prepareNavigation())) return;
              map.showAsIs();
              await open(entity, id);
            })();
          },
          openScenario: (id) => {
            void open("scenario", id);
          },
        });
      })();
    },
  });
  const element = el("main", { class: "workspace" }, list.element, map.element, editor.element);
  const focusEditor = button("Focus editor", () => {
    const focused = element.classList.toggle("editor-focused");
    focusEditor.textContent = focused ? "Show full workspace" : "Focus editor";
    focusEditor.setAttribute("aria-pressed", String(focused));
  });
  element.prepend(
    el(
      "nav",
      { class: "workspace-navigation", "aria-label": "Record navigation" },
      backButton,
      focusEditor,
      navigationStatus,
    ),
  );

  function setRepository(next: Repository): void {
    unsubscribe();
    repo = next;
    sessionId++;
    ++navigationRequest;
    pendingReturn = null;
    mapNavigation = false;
    projectedOrigin = null;
    navigationHistory.length = 0;
    backButton.disabled = true;
    unsubscribe = repo.subscribe(() => {
      const errors: unknown[] = [];
      const refreshers = [
        (): void => {
          list.render();
        },
        (): void => {
          editor.refresh();
        },
        (): void => {
          map.refresh();
        },
      ];
      for (const refresh of refreshers) {
        try {
          refresh();
        } catch (error) {
          errors.push(error);
        }
      }
      if (projectedOrigin) {
        editor.close();
        projectedOrigin = null;
        navigationStatus.textContent =
          "The dataset changed. Select the projected record again to inspect its current state.";
      }
      if (errors.length > 0) throw new AggregateError(errors, "The workspace could not fully refresh.");
    });
    editor.close();
    list.render();
    map.reset();
  }

  setRepository(initial);
  return {
    element,
    setRepository,
    historyChanged: () => {
      editor.reload();
      if (projectedOrigin && !map.inspectOrigin(projectedOrigin)) {
        editor.close();
        projectedOrigin = null;
        navigationStatus.textContent = "The projected target is no longer available.";
      }
    },
    hasPendingDraft: () => editor.hasPendingDraft(),
    pendingDraftLabel: () => editor.pendingDraftLabel(),
    applyActiveDraft: () => editor.applyActiveDraft(),
    discardActiveDraft: () => {
      editor.discardActiveDraft();
    },
    resolveActiveDraft,
    sessionIdentity: () => sessionId,
    activeDraftToken: () => draftToken,
    settlePendingPlacement: () => map.settlePendingPlacement(),
  };
}
