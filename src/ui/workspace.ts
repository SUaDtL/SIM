import type { Repository } from "../domain/repository";
import type { Snapshot } from "../domain/types";
import { downloadBlob, suggestedImageName } from "../file/dataset-file";
import { createMapView, type MapViewState } from "../map/map-view";
import { button, el } from "./dom";
import { createEditor } from "./editor-panel";
import { createListPanel, type ListPanel, type Selection } from "./list-panel";
import { descriptor } from "./forms";
import { type EntityTarget } from "./relations";
import {
  captureRecordSummaryView,
  createRecordSummary,
  restoreRecordSummaryView,
  type RecordSummaryViewContext,
  type SummarySection,
} from "./record-summary";
import { dependencyKey, serviceOrigin, type ProjectedSnapshot } from "../scenario/scenario";
import { describeChange } from "./scenario-changes";

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
  refreshView(): void;
  inspectRecord(target: EntityTarget): Promise<void>;
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
  let surface: "inventory" | "map" = "inventory";
  let inspectorParked = false;
  let editorFocus: HTMLElement | null = null;
  type NavigationEntry = {
    selection: Selection | null;
    editorView: ReturnType<typeof editor.viewContext>;
    surface: "inventory" | "map";
    inspectorParked: boolean;
    map: MapViewState;
    list: ReturnType<ListPanel["viewContext"]>;
    focus: HTMLElement | null;
    focusBookmark: { scope: HTMLElement; index: number; id: string; tag: string; text: string } | null;
    origin: Parameters<typeof editor.inspectProjected>[0]["data"]["origin"] | null;
  };
  const navigationHistory: NavigationEntry[] = [];
  const inspectionDialogs = new Set<HTMLDialogElement>();
  let pendingReturn: NavigationEntry | null = null;
  let navigationRequest = 0;
  let inspectConnection: (
    consumer: number,
    provider: number,
    snapshot: Snapshot,
    readOnly: boolean,
    stateLabel?: string,
    scope?: "pending" | "recorded" | "projected",
  ) => void = () => undefined;
  let projectedOrigin: Parameters<typeof editor.inspectProjected>[0]["data"]["origin"] | null = null;
  let restoringOrigin = false;
  const navigationStatus = el("p", { role: "status", "data-testid": "navigation-status" });
  let applyRefusal: { draftId: number; sessionId: number } | null = null;
  function setNavigationStatus(text: string, draftId?: number): void {
    applyRefusal = draftId === undefined ? null : { draftId, sessionId };
    navigationStatus.textContent = text;
  }
  function resolveDraftFeedback(draftId: number): void {
    if (applyRefusal?.draftId === draftId && applyRefusal.sessionId === sessionId) setNavigationStatus("");
  }
  const backButton = button("Back", () => {
    void back();
  });
  backButton.disabled = true;

  function captureNavigation(): NavigationEntry {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = focused?.closest<HTMLDetailsElement>(
      "details.record-secondary-actions, details.record-actions, details.connection-actions",
    );
    const active = menu?.querySelector<HTMLElement>("summary") ?? focused;
    const scope = [editor.element, list.element, map.element].find((region) => active && region.contains(active));
    return {
      selection: editor.selection(),
      editorView: editor.viewContext(),
      surface,
      inspectorParked,
      map: map.captureView(),
      list: list.viewContext(),
      focus: active,
      focusBookmark:
        active && scope
          ? {
              scope,
              index: [
                ...scope.querySelectorAll<HTMLElement>("button, input, select, textarea, summary, a[href], [tabindex]"),
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
      ...bookmark.scope.querySelectorAll<HTMLElement>("button, input, select, textarea, summary, a[href], [tabindex]"),
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
      if (previous.selection.id === null || previous.editorView.editing)
        editor.open(previous.selection.type, previous.selection.id);
      else editor.inspect(previous.selection.type, previous.selection.id);
      editor.restoreViewContext(previous.editorView);
    } else {
      editor.close();
      setNavigationStatus(previous.selection ? "The previous record no longer exists." : "Returned to the workspace.");
    }
    surface = previous.surface;
    inspectorParked = previous.inspectorParked;
    syncSurface();
    map.restoreView(previous.map);
    if (previous.origin) {
      restoringOrigin = true;
      if (!map.inspectOrigin(previous.origin)) {
        restoringOrigin = false;
        setNavigationStatus("The previous projected target is no longer available.");
      }
    }
    list.restoreContext(previous.list);
    restoreNavigationFocus(previous);
    backButton.disabled = navigationHistory.length === 0;
  }

  function peek(target: EntityTarget, snapshot?: Snapshot, context?: string): void {
    const focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = el("dialog", { "aria-label": "Inspect related record" });
    inspectionDialogs.add(dialog);
    const close = (): void => {
      dialog.close();
      dialog.remove();
      focusBefore?.focus();
      inspectionDialogs.delete(dialog);
    };
    const owner = repo;
    const session = sessionId;
    const history: {
      target: EntityTarget;
      view: RecordSummaryViewContext | undefined;
      scroll: number;
      reference?: string;
    }[] = [];
    let currentTarget = target;
    function draw(next: EntityTarget, previous?: (typeof history)[number]): void {
      if (repo !== owner || session !== sessionId) {
        dialog.replaceChildren(
          el("p", {}, "The dataset changed. Close this inspector and select a current record."),
          button("Close", close),
        );
        return;
      }
      const change =
        next.type === "scenario" && next.changeId !== undefined
          ? (snapshot ?? owner.snapshot()).scenarioChanges.find(
              (item) => item.scenarioId === next.id && item.id === next.changeId,
            )
          : undefined;
      const summary =
        next.type === "scenario" && next.changeId !== undefined
          ? el(
              "section",
              { class: "record-summary", "data-scenario-change-id": String(next.changeId) },
              el("h2", { tabindex: "-1" }, "Scenario change"),
              el(
                "p",
                {},
                change
                  ? describeChange(owner, change, owner.listScenarioChanges(next.id))
                  : "This scenario change is no longer available.",
              ),
              el(
                "p",
                {},
                "Remove and re-add this change in its scenario to revise it. Changes already added take effect immediately; Undo can reverse them.",
              ),
              ...(change
                ? [
                    button("Review in scenario editor", () => {
                      close();
                      void (async () => {
                        if (owner !== repo || session !== sessionId) return;
                        await open("scenario", next.id, true);
                        if (
                          owner === repo &&
                          session === sessionId &&
                          editor.selection()?.type === "scenario" &&
                          editor.selection()?.id === next.id
                        )
                          editor.revealScenarioChange(change.id);
                      })();
                    }),
                  ]
                : []),
            )
          : createRecordSummary({
              repo: owner,
              target: next,
              ...(snapshot ? { snapshot, readOnly: true } : {}),
              ...(context ? { context } : {}),
              ...(previous?.view ? { initialView: previous.view } : {}),
              onNavigate: (destination) => {
                const current = dialog.querySelector<HTMLElement>(".record-summary");
                const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                const reference = active?.dataset["summaryReference"];
                history.push({
                  target: currentTarget,
                  view: current ? captureRecordSummaryView(current) : undefined,
                  scroll: dialog.scrollTop,
                  ...(reference ? { reference } : {}),
                });
                if (history.length > 64) history.shift();
                draw(destination);
              },
              onEdit: (section) => {
                close();
                if (repo === owner && session === sessionId) void open(next.type, next.id, true, editSection(section));
              },
              onDependency: (consumer, provider) => {
                if (repo === owner && session === sessionId)
                  inspectConnection(consumer, provider, snapshot ?? owner.snapshot(), snapshot !== undefined, context);
              },
            });
      currentTarget = next;
      const back = button("Back", () => {
        const entry = history.pop();
        if (entry) draw(entry.target, entry);
      });
      back.disabled = history.length === 0;
      dialog.replaceChildren(summary, back, button("Close", close));
      if (previous) {
        if (previous.view) restoreRecordSummaryView(summary, previous.view, { focus: true });
        dialog.scrollTop = previous.scroll;
        if (previous.reference)
          [...summary.querySelectorAll<HTMLElement>("[data-summary-reference]")]
            .find((control) => control.dataset["summaryReference"] === previous.reference)
            ?.focus({ preventScroll: true });
      } else if (dialog.open) dialog.querySelector<HTMLElement>("h2")?.focus();
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

  function applyActiveDraft(): boolean {
    const owner = editor.activeDraftId();
    const applied = editor.applyActiveDraft();
    if (!applied) {
      inspectorParked = false;
      syncSurface();
      setNavigationStatus("The draft could not be applied. Review the editor errors and try again.", owner);
      const target =
        editor.element.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        editor.element.querySelector<HTMLElement>('[role="alert"]:not(:empty)');
      const active = document.activeElement;
      const completionFocused =
        active instanceof HTMLElement &&
        editor.element.contains(active) &&
        active.matches("button, input, select, textarea") &&
        active.getClientRects().length > 0;
      if (target && !completionFocused) {
        if (!target.matches("button, input, select, textarea")) target.tabIndex = -1;
        target.focus();
      }
    } else resolveDraftFeedback(owner);
    return applied;
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
      if (!applyActiveDraft()) return false;
      if (kind === "capture") await map.settlePendingPlacement();
      return true;
    }
    if (kind !== "capture") editor.discardActiveDraft();
    return true;
  }

  function editSection(section: string | undefined): "details" | "connections" | "support" {
    return section === "connections" || section === "support" ? section : "details";
  }

  function readSection(section: string): SummarySection {
    return section === "connections" || section === "support" ? section : "overview";
  }

  function focusResults(): void {
    const target =
      surface === "inventory"
        ? (list.element.querySelector<HTMLElement>('[aria-current="true"]') ??
          list.element.querySelector<HTMLElement>("#list-filter"))
        : map.element.querySelector<HTMLElement>("#map-find");
    target?.focus();
  }

  async function open(
    type: Parameters<typeof editor.open>[0],
    id: number | null,
    edit = false,
    section?: "details" | "connections" | "support",
  ): Promise<void> {
    const focused = pendingReturn?.focus ?? document.activeElement;
    const fromFind = focused instanceof Element && focused.closest(".find-results") !== null;
    const focusFoundRecord = (): void => {
      if (fromFind) editor.element.querySelector<HTMLElement>(".record-summary h2")?.focus();
    };
    if (
      editor.selection()?.type === type &&
      editor.selection()?.id === id &&
      !projectedOrigin &&
      (!edit || editor.isEditing())
    ) {
      pendingReturn = null;
      inspectorParked = false;
      syncSurface();
      if (edit && section) {
        const view = editor.viewContext();
        editor.restoreViewContext({
          ...view,
          section,
          scrollTop: view.section === section ? view.scrollTop : (view.sectionScroll?.[section] ?? 0),
        });
      }
      focusFoundRecord();
      return;
    }
    if (!pendingReturn && !(await prepareNavigation())) return;
    if (id !== null && descriptor(type).get(repo, id) === undefined) {
      pendingReturn = null;
      setNavigationStatus("That record no longer exists. Choose another result.");
      return;
    }
    rememberReturn();
    projectedOrigin = null;
    inspectorParked = false;
    if (id === null || edit) editor.open(type, id, section);
    else editor.inspect(type, id);
    setNavigationStatus("");
    list.reveal(type);
    if (id !== null && ["service", "network", "cds"].includes(type))
      map.select(type as "service" | "network" | "cds", id);
    syncSurface();
    focusFoundRecord();
  }

  async function openServiceOnNetwork(networkId: number): Promise<void> {
    if (!(await prepareNavigation())) return;
    if (!repo.getNetwork(networkId)) {
      pendingReturn = null;
      setNavigationStatus("That network no longer exists. Choose another network.");
      return;
    }
    rememberReturn();
    projectedOrigin = null;
    inspectorParked = false;
    editor.openServiceOnNetwork(networkId);
    setNavigationStatus("");
    list.reveal("service");
    syncSurface();
  }

  const editor = createEditor({
    repo: () => repo,
    selectionChanged: () => {
      list.render();
      syncSurface();
    },
    draftResolved: resolveDraftFeedback,
    draftChanged: () => {
      draftToken++;
      onDraftChanged();
    },
    requestServiceOnNetwork: (networkId) => {
      void openServiceOnNetwork(networkId);
    },
    requestNavigate: (target, intent) => {
      if (intent === "peek") peek(target);
      else void open(target.type, target.id, true, target.type === "service" ? "connections" : undefined);
    },
    requestCancel: () => {
      void (async () => {
        const previous = editor.selection();
        const draft = editor.activeDraftId();
        const section = readSection(editor.viewContext().section);
        const origin = navigationHistory.at(-1);
        const owner = repo;
        const session = sessionId;
        const request = ++navigationRequest;
        if (
          !(await resolveActiveDraft("navigate")) ||
          owner !== repo ||
          session !== sessionId ||
          request !== navigationRequest
        )
          return;
        resolveDraftFeedback(draft);
        if (previous?.id === null && origin && navigationHistory.at(-1) === origin) {
          await back();
          return;
        }
        if (previous?.id !== null && previous && descriptor(previous.type).get(repo, previous.id) !== undefined)
          editor.inspect(previous.type, previous.id, section);
        else editor.close();
        syncSurface();
      })();
    },
    requestSimilar: (sourceId) => {
      void (async () => {
        const owner = repo;
        const session = sessionId;
        if (!(await prepareNavigation()) || owner !== repo || session !== sessionId) return;
        rememberReturn();
        projectedOrigin = null;
        inspectorParked = false;
        editor.createSimilar(sourceId);
        syncSurface();
      })();
    },
    requestDependency: (consumer, provider, pending) => {
      const source = pending?.snapshot ?? repo.snapshot();
      inspectConnection(
        consumer,
        provider,
        source,
        pending !== undefined,
        pending?.label,
        pending?.scope ?? (pending ? "pending" : "recorded"),
      );
    },
    recordDeleted: (type) => {
      setNavigationStatus(`${descriptor(type).label} deleted. Undo can restore it.`);
      focusResults();
    },
  });
  const list = createListPanel({
    repo: () => repo,
    selection: () => editor.selection(),
    requestServiceOnNetwork: (networkId) => {
      void openServiceOnNetwork(networkId);
    },
    select: (type, id) => {
      void open(type, id);
    },
  });
  const map = createMapView({
    snapshot: () => repo.snapshot(),
    resolveNavigation: async () => {
      const accepted = await prepareNavigation();
      return accepted;
    },
    navigationAborted: () => {
      pendingReturn = null;
    },
    projectionChanged: () => {
      if (projectedOrigin) {
        editor.close();
        projectedOrigin = null;
        setNavigationStatus("Projection changed. Select a record in the current view.");
      }
    },
    inspectDependency: (inspectConnection = (
      consumer,
      provider,
      projected,
      readOnly,
      stateLabel?: string,
      scope?: "pending" | "recorded" | "projected",
    ) => {
      const row = projected.dependencies.find(
        (d) => d.consumerServiceId === consumer && d.providerServiceId === provider,
      );
      if (!row) {
        setNavigationStatus("That connection is no longer available in this view. Select a current connection.");
        return;
      }
      const provenance =
        "projection" in projected
          ? (projected as ProjectedSnapshot).projection.dependencyProvenance.get(dependencyKey(row))
          : undefined;
      const projection = "projection" in projected ? (projected as ProjectedSnapshot).projection : null;
      const originChangeIds = new Set(provenance?.responsibleChangeIds ?? []);
      if (projection) {
        for (const endpoint of [consumer, provider]) {
          const origin = serviceOrigin(projected, endpoint);
          if (origin.kind === "planned") originChangeIds.add(origin.changeId);
        }
        const sourceIds = new Set(
          (provenance?.sourceDependencies ?? []).flatMap((source) => [
            source.consumerServiceId,
            source.providerServiceId,
          ]),
        );
        for (const change of projected.scenarioChanges) {
          if (change.scenarioId === projection.scenarioId && change.kind !== "add" && sourceIds.has(change.serviceId))
            originChangeIds.add(change.id);
        }
      }
      const scenario = projected.scenarios.find((item) => item.id === projection?.scenarioId);
      const originDescription = (id: number): string => {
        const origin = serviceOrigin(projected, id);
        return origin.kind === "planned"
          ? `Planned in ${scenario?.name ?? "this scenario"}: ${(() => {
              const change = projected.scenarioChanges.find((item) => item.id === origin.changeId);
              return change
                ? describeChange(repo, change, projected.scenarioChanges)
                : "originating change unavailable";
            })()}`
          : `Recorded service: ${qualify(origin.serviceId)}`;
      };
      const qualify = (id: number): string => {
        const s = projected.services.find((item) => item.id === id);
        return `${s?.name ?? "Unavailable"} (${projected.networks.find((n) => n.id === s?.networkId)?.name ?? "Unknown network"})`;
      };
      const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const dialog = el("dialog", { "aria-label": "Connection inspector" });
      inspectionDialogs.add(dialog);
      const owner = repo;
      const session = sessionId;
      const close = (): void => {
        dialog.close();
        dialog.remove();
        before?.focus();
        inspectionDialogs.delete(dialog);
      };
      dialog.append(
        el("h2", {}, stateLabel ?? "Recorded dependency"),
        el("p", {}, `${qualify(consumer)} → ${qualify(provider)}`),
        ...(readOnly && projection
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
        ...(projection
          ? [...originChangeIds].flatMap((changeId) => {
              const change = projected.scenarioChanges.find(
                (item) => item.scenarioId === projection.scenarioId && item.id === changeId,
              );
              return change
                ? [
                    button(`Review: ${describeChange(owner, change, projected.scenarioChanges)}`, () => {
                      if (repo === owner && session === sessionId)
                        peek({ type: "scenario", id: projection.scenarioId, changeId });
                    }),
                  ]
                : [];
            })
          : []),
        readOnly
          ? el(
              "p",
              {},
              projection
                ? "Projected connection, read-only. Edit its originating scenario to change the projection."
                : scope === "pending"
                  ? "Pending changes — not yet applied. This inspector shows the staged connection. Finish editing in the current service, then Apply changes to record it."
                  : "Current As-Is connection, read-only. These are recorded baseline details, including applied changes not yet saved to file. This service is removed from the displayed proposal.",
            )
          : button("Edit consuming service", () => {
              close();
              if (repo !== owner || session !== sessionId) return;
              if (
                !repo
                  .listDependencies()
                  .some((item) => item.consumerServiceId === consumer && item.providerServiceId === provider)
              ) {
                setNavigationStatus("That connection no longer exists. Select a current connection.");
                return;
              }
              void open("service", consumer, true, "connections");
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
        if (!restoring) rememberReturn();
        inspectorParked = false;
        projectedOrigin = node.data.origin;
        setNavigationStatus("");
        list.reveal(node.data.entity);
        editor.inspectProjected(node, view, projected, comparison, {
          inspectRecord: (target) => {
            if (target.type === "service") {
              void (async () => {
                if (!(await prepareNavigation())) return;
                const origin = serviceOrigin(projected, target.id);
                map.inspectOrigin(
                  origin.kind === "planned"
                    ? { kind: "planned", entity: "service", scenarioId: view.scenarioId, changeId: origin.changeId }
                    : { kind: "baseline", entity: "service", entityId: origin.serviceId },
                );
              })();
            } else
              peek(target, projected, `${view.kind === "compare" ? "Compare" : "To-Be"} · read-only projected record`);
          },
          editAsIs: (entity, id) => {
            void (async () => {
              if (!(await prepareNavigation())) return;
              map.showAsIs();
              await open(entity, id, true);
              map.reveal(entity, id);
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
  const inventoryButton = button("Inventory", () => {
    inspectorParked = editor.selection() !== null || projectedOrigin !== null;
    surface = "inventory";
    syncSurface();
  });
  const mapButton = button("Map", () => {
    inspectorParked = editor.selection() !== null || projectedOrigin !== null;
    surface = "map";
    syncSurface();
  });
  const returnButton = button("Return to results", () => {
    inspectorParked = true;
    syncSurface();
    focusResults();
  });
  const returnToEditor = button("Return to draft", () => {
    inspectorParked = false;
    syncSurface();
    if (editorFocus?.isConnected) editorFocus.focus({ preventScroll: true });
    else editor.element.querySelector<HTMLElement>("input:not([hidden]), button, h2")?.focus();
  });
  editor.element.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement) editorFocus = event.target;
  });
  function syncSurface(): void {
    list.element.hidden = surface !== "inventory";
    map.element.hidden = surface !== "map";
    inventoryButton.setAttribute("aria-pressed", String(surface === "inventory"));
    mapButton.setAttribute("aria-pressed", String(surface === "map"));
    const selected = (editor.selection() !== null || projectedOrigin !== null) && !inspectorParked;
    element.classList.toggle("has-selection", selected);
    element.classList.toggle("editing", editor.isEditing() && !inspectorParked);
    element.dataset["surface"] = surface;
    editor.element.hidden = !selected;
    returnButton.hidden = !selected || editor.isEditing();
    returnToEditor.hidden = !inspectorParked || (editor.selection() === null && projectedOrigin === null);
    returnToEditor.textContent = editor.isEditing() ? "Return to draft" : "Show selected record";
  }
  element.prepend(
    el(
      "nav",
      { class: "workspace-navigation", "aria-label": "Workspace" },
      inventoryButton,
      mapButton,
      backButton,
      returnButton,
      returnToEditor,
      navigationStatus,
    ),
  );
  element.addEventListener("keydown", (event) => {
    if (event.key !== "F2" || editor.isEditing()) return;
    const selection = editor.selection();
    if (selection?.id !== null && selection) {
      event.preventDefault();
      void open(selection.type, selection.id, true, editSection(editor.viewContext().section));
    }
  });

  function setRepository(next: Repository): void {
    for (const dialog of inspectionDialogs) {
      dialog.close();
      dialog.remove();
    }
    inspectionDialogs.clear();
    unsubscribe();
    repo = next;
    sessionId++;
    setNavigationStatus("");
    ++navigationRequest;
    pendingReturn = null;
    projectedOrigin = null;
    inspectorParked = false;
    editorFocus = null;
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
        setNavigationStatus("The dataset changed. Select the projected record again to inspect its current state.");
      }
      if (errors.length > 0) throw new AggregateError(errors, "The workspace could not fully refresh.");
    });
    editor.close();
    list.reset();
    map.reset();
    syncSurface();
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
        setNavigationStatus("The projected target is no longer available.");
      }
    },
    hasPendingDraft: () => editor.hasPendingDraft(),
    pendingDraftLabel: () => editor.pendingDraftLabel(),
    applyActiveDraft,
    discardActiveDraft: () => {
      editor.discardActiveDraft();
    },
    resolveActiveDraft,
    sessionIdentity: () => sessionId,
    activeDraftToken: () => draftToken,
    settlePendingPlacement: () => map.settlePendingPlacement(),
    refreshView: () => {
      list.render();
      editor.refresh();
      map.refresh();
      syncSurface();
    },
    inspectRecord: async (target) => {
      if (target.type === "scenario" && target.changeId !== undefined) peek(target);
      else await open(target.type, target.id);
    },
  };
}
