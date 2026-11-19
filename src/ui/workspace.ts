import { assessmentPanel } from "./assessment-panel";
import { mountAssessmentNotes, type NoteListPosition } from "./assessment-notes";
import { resolveNoteTarget } from "../assessment/note-target";
import type { GraphOrigin } from "../map/graph";
import type { NoteTarget } from "../assessment/notes";
import { openAtlasFind, type FindRecord } from "./atlas-find";
import type { PickerPosition } from "./reference-picker";
import { openBatchAssignment } from "./batch-assignment";
import { openDecisionViews, type DecisionPosition } from "./decision-views";
import { freezeAssessment } from "../assessment/output";
import { BUILD } from "../build-info";
import { LATEST_VERSION } from "../db/migrate";
import { manageViewpoints } from "./saved-viewpoints";
import type { Repository } from "../domain/repository";
import type { ExchangeTable } from "../domain/assessment-context";
import type { Snapshot } from "../domain/types";
import { downloadBlob, suggestedImageName } from "../file/dataset-file";
import { createMapView, type AssessmentMapView, type MapViewState } from "../map/map-view";
import { button, el } from "./dom";
import { createEditor } from "./editor-panel";
import { createListPanel, type ListPanel, type Selection } from "./list-panel";
import { descriptor } from "./forms";
import { inventoryRecords, type EntityTarget } from "./relations";
import {
  captureRecordSummaryView,
  createRecordSummary,
  restoreRecordSummaryView,
  type RecordSummaryViewContext,
  type SummarySection,
} from "./record-summary";
import {
  applyScenario,
  compareScenario,
  dependencyKey,
  serviceOrigin,
  type ProjectedSnapshot,
  type ServiceOrigin,
} from "../scenario/scenario";
import { describeChange } from "./scenario-changes";
import "./inspector.css";

export interface Workspace {
  readonly element: HTMLElement;
  /** Show a (new or reopened) dataset: drops the old selection and listens to the new repository. */
  setRepository(repo: Repository): void;
  /** Apply one history step and restore forms and feedback for the resulting selection. */
  travelHistory(direction: "undo" | "redo"): void;
  hasPendingDraft(): boolean;
  pendingDraftLabel(): string;
  applyActiveDraft(): boolean;
  discardActiveDraft(): void;
  resolveActiveDraft(kind: "navigate" | "history" | "import" | "capture" | "export"): Promise<boolean>;
  sessionIdentity(): number;
  activeDraftToken(): number;
  settlePendingPlacement(): Promise<void>;
  refreshView(): void;
  assessmentView(includeMap: boolean): AssessmentMapView;
  hasAssessmentDraft(): boolean;
  mapIsOpen(): boolean;
  showMap(): void;
  startNetwork(): Promise<void>;
  inspectRecord(target: EntityTarget): Promise<void>;
  addAssessmentCommands(...groups: HTMLElement[]): void;
}

/** The three-region layout: entity list (left), map area (center), editor (right). */
export function createWorkspace(
  initial: Repository,
  onDraftChanged: () => void = () => undefined,
  captureUnsaved: () => boolean = () => true,
  startPanel?: HTMLElement,
): Workspace {
  let repo = initial;
  let viewpointDraft = false;
  let batchDraft = false;
  let recordNoteDraft = false;
  let unsubscribe = (): void => undefined;
  let sessionId = 0;
  let draftToken = 0;
  let surface: "inventory" | "map" = window.matchMedia("(max-width: 480px)").matches ? "map" : "inventory";
  let activeFind: ReturnType<typeof openAtlasFind> | null = null;
  type FindReturn = { position: PickerPosition; surface: "inventory" | "map"; map: MapViewState | null };
  let findReturn: FindReturn | null = null;
  let inspectorParked = false;
  let editorFocus: HTMLElement | null = null;
  type Perspective = MapViewState["view"];
  type ReadingSubject =
    | { kind: "record"; target: EntityTarget; origin?: ServiceOrigin; view?: Perspective; context?: string }
    | {
        kind: "connection";
        consumer: ServiceOrigin;
        provider: ServiceOrigin;
        view?: Perspective;
        readOnly: boolean;
        label?: string;
        scope?: "pending" | "recorded" | "projected";
        pendingRoute?: number | null;
      }
    | { kind: "notes"; scope?: NoteTarget; position?: NoteListPosition }
    | { kind: "assertion"; target: NoteTarget }
    | { kind: "unavailable"; message: string; origin: GraphOrigin | null };
  const readingPanel = el("section", {
    class: "editor contextual-inspector",
    role: "region",
    "data-mode": "read",
    hidden: "",
  });
  let reading: ReadingSubject | null = null;
  let notesController: ReturnType<typeof mountAssessmentNotes> | undefined;
  let readerSession = 0;
  type NavigationEntry = {
    identities: { table: ExchangeTable; key: string; identity: string }[];
    reading: ReadingSubject | null;
    readerView: RecordSummaryViewContext | undefined;
    readerScroll: number;
    expanded: boolean;
    selection: Selection | null;
    editorView: ReturnType<typeof editor.viewContext>;
    surface: "inventory" | "map";
    inspectorParked: boolean;
    map: MapViewState;
    list: ReturnType<ListPanel["viewContext"]>;
    focus: HTMLElement | null;
    focusBookmark: { scope: HTMLElement; index: number; id: string; tag: string; text: string } | null;
    origin: Parameters<typeof editor.inspectProjected>[0]["data"]["origin"] | null;
    findReturn: FindReturn | null;
    decision?: DecisionPosition;
  };
  const navigationHistory: NavigationEntry[] = [];
  const inspectionDialogs = new Set<HTMLDialogElement>();
  function serviceNotes(id: number): void {
    const identity = repo.exchangeIdentities("service").get(String(id));
    const target = repo.assessmentTargets().find((row) => row.kind === "service" && row.id === identity);
    if (target) void enterReading({ kind: "notes", scope: target });
  }
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
  const backButton = button(
    "Back",
    () => {
      void back();
    },
    { "data-atlas-action": "back" },
  );
  backButton.disabled = true;

  function captureNavigation(): NavigationEntry {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = focused?.closest<HTMLDetailsElement>(
      "details.record-secondary-actions, details.record-actions, details.connection-actions, details.workspace-assessment, details.file-menu",
    );
    const active = menu?.querySelector<HTMLElement>("summary") ?? focused;
    const scope = [readingPanel, editor.element, list.element, map.element].find(
      (region) => active && region.contains(active),
    );
    const selection = editor.selection();
    const state = map.captureView();
    const identities: NavigationEntry["identities"] = [];
    const retain = (table: ExchangeTable, key: number | string): void => {
      const value = String(key);
      const identity = repo.exchangeIdentities(table).get(value);
      if (identity) identities.push({ table, key: value, identity });
    };
    const retainService = (origin: ServiceOrigin): void => {
      if (origin.kind === "planned") {
        retain("scenario", origin.scenarioId);
        retain("scenario_change", origin.changeId);
      } else retain("service", origin.serviceId);
    };
    if (state.view.kind !== "as-is") retain("scenario", state.view.scenarioId);
    if (reading?.kind === "record") {
      if (reading.origin) retainService(reading.origin);
      else retain(reading.target.type, reading.target.id);
      if (reading.target.changeId !== undefined) retain("scenario_change", reading.target.changeId);
    } else if (reading?.kind === "connection") {
      retainService(reading.consumer);
      retainService(reading.provider);
      if (
        reading.scope !== "pending" &&
        !reading.readOnly &&
        reading.consumer.kind === "baseline" &&
        reading.provider.kind === "baseline"
      )
        retain("service_dependency", [reading.consumer.serviceId, reading.provider.serviceId].join(":"));
    } else if (!reading) {
      if (projectedOrigin?.kind === "planned") retainService(projectedOrigin);
      else if (projectedOrigin) retain(projectedOrigin.entity, projectedOrigin.entityId);
      else if (selection && selection.id !== null) retain(selection.type, selection.id);
    }
    return {
      identities,
      reading:
        reading?.kind === "notes" && notesController ? { ...reading, position: notesController.position() } : reading,
      readerView: captureRecordSummaryView(readingPanel.querySelector<HTMLElement>(".record-summary") ?? readingPanel),
      readerScroll: readingPanel.scrollTop,
      expanded: inspectorExpanded,
      selection,
      editorView: editor.viewContext(),
      surface,
      inspectorParked,
      map: state,
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
      findReturn,
    };
  }

  function restoreNavigationFocus(entry: NavigationEntry): void {
    if (entry.focus?.isConnected && entry.focus.getClientRects().length) {
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
    pendingReturn = null;
    const before = captureNavigation();
    const request = ++navigationRequest;
    const session = sessionId;
    if (!(await resolveActiveDraft("navigate", request)) || request !== navigationRequest || session !== sessionId) {
      if (!applyRefusal && request === navigationRequest && session === sessionId) {
        if (reading && editor.isEditing() && editor.hasPendingDraft()) await back(true);
        else restoreNavigationFocus(before);
      }
      return false;
    }
    pendingReturn = before;
    return true;
  }

  function rememberReturn(): void {
    const before = pendingReturn ?? captureNavigation();
    pendingReturn = null;
    findReturn = null;
    navigationHistory.push(before);
    if (navigationHistory.length > 64) navigationHistory.shift();
    backButton.disabled = false;
  }

  async function back(closeReading = false): Promise<void> {
    const lastDifferent = navigationHistory.map((entry) => entry.reading?.kind !== reading?.kind).lastIndexOf(true);
    const destination = closeReading && lastDifferent >= 0 ? lastDifferent : navigationHistory.length - 1;
    const previous = navigationHistory[destination];
    const session = sessionId;
    const request = ++navigationRequest;
    const withinPreview =
      reading !== null &&
      editor.isEditing() &&
      previous?.selection?.type === editor.selection()?.type &&
      previous?.selection?.id === editor.selection()?.id;
    if (!previous || (!withinPreview && !(await resolveActiveDraft("navigate", request)))) return;
    if (session !== sessionId || request !== navigationRequest || navigationHistory[destination] !== previous) return;
    navigationHistory.splice(destination);
    const wasReading = reading !== null;
    clearReader();
    inspectorExpanded = previous.expanded;
    projectedOrigin = null;
    pendingReturn = null;
    const missingIdentities = previous.identities.filter(
      ({ table, key, identity }) => repo.exchangeIdentities(table).get(key) !== identity,
    );
    if (missingIdentities.length) {
      editor.close();
      surface = previous.surface;
      inspectorParked = false;
      syncSurface();
      const unavailableScenario = missingIdentities.some(({ table }) => table === "scenario");
      const replaced = missingIdentities.some(({ table, key }) => repo.exchangeIdentities(table).has(key));
      map.restoreView({
        ...(replaced && previous.map.focusReturn ? previous.map.focusReturn : previous.map),
        ...(unavailableScenario ? { view: { kind: "as-is" } as const } : {}),
        selectedNode: null,
        chainRoot: null,
        ...(replaced || unavailableScenario ? { focus: null, focusReturn: null } : {}),
      });
      list.restoreContext(previous.list);
      findReturn = previous.findReturn;
      backButton.disabled = navigationHistory.length === 0;
      drawReading({
        kind: "unavailable",
        origin: null,
        message: "The previous record or relationship no longer exists. Back returns to the earlier investigation.",
      });
      setNavigationStatus(
        previous.origin
          ? "The previous projected target is no longer available."
          : "The previous subject is no longer available.",
      );
      return;
    }
    const sameEditor =
      wasReading &&
      editor.selection()?.type === previous.selection?.type &&
      editor.selection()?.id === previous.selection?.id;
    let restoreEditorView = false;
    if (
      sameEditor &&
      (previous.selection?.id == null || descriptor(previous.selection.type).get(repo, previous.selection.id))
    ) {
      restoreEditorView = !editor.hasPendingDraft();
    } else if (
      previous.selection &&
      (previous.selection.id === null ||
        descriptor(previous.selection.type).get(repo, previous.selection.id) !== undefined)
    ) {
      if (previous.selection.id === null || previous.editorView.editing)
        editor.open(previous.selection.type, previous.selection.id);
      else editor.inspect(previous.selection.type, previous.selection.id);
      restoreEditorView = true;
    } else {
      editor.close();
      setNavigationStatus(previous.selection ? "The previous record no longer exists." : "Returned to the workspace.");
    }
    surface = previous.surface;
    inspectorParked = previous.inspectorParked;
    syncSurface();
    if (restoreEditorView) editor.restoreViewContext(previous.editorView);
    map.restoreView(previous.map);
    if (previous.origin && !previous.reading) {
      restoringOrigin = true;
      if (!map.inspectOrigin(previous.origin)) {
        restoringOrigin = false;
        setNavigationStatus("The previous projected target is no longer available.");
      }
    }
    if (previous.reading) drawReading(previous.reading, previous.readerView);
    readingPanel.scrollTop = previous.readerScroll;
    list.restoreContext(previous.list);
    findReturn = previous.findReturn;
    restoreNavigationFocus(previous);
    backButton.disabled = navigationHistory.length === 0;
    if (previous.decision) showDecisionViews(previous.decision);
  }

  function clearReader(): void {
    reading = null;
    ++readerSession;
    notesController?.dispose();
    notesController = undefined;
    readingPanel.replaceChildren();
    readingPanel.hidden = true;
  }

  function snapshotFor(view?: Perspective): Snapshot {
    const base = repo.snapshot();
    if (!view || view.kind === "as-is") return base;
    return view.kind === "compare"
      ? compareScenario(base, view.scenarioId).overlay
      : applyScenario(base, view.scenarioId);
  }

  async function enterReading(subject: ReadingSubject, preview = false): Promise<boolean> {
    if (!preview && !pendingReturn && !(await prepareNavigation())) return false;
    rememberReturn();
    inspectorParked = false;
    if (subject.kind === "notes" && window.matchMedia("(max-width: 700px)").matches) inspectorExpanded = true;
    drawReading(subject);
    return true;
  }

  function resolveService(snapshot: Snapshot, origin: ServiceOrigin): number | undefined {
    if (origin.kind === "baseline")
      return snapshot.services.find(
        (row) => row.id === origin.serviceId && serviceOrigin(snapshot, row.id).kind === "baseline",
      )?.id;
    const projection = "projection" in snapshot ? (snapshot as ProjectedSnapshot).projection : null;
    return projection?.scenarioId === origin.scenarioId ? projection.plannedServiceIds.get(origin.changeId) : undefined;
  }

  function showOnMap(reveal: () => boolean, missing: string): void {
    const previous = captureNavigation();
    if (!reveal()) {
      setNavigationStatus(missing);
      return;
    }
    pendingReturn = previous;
    rememberReturn();
    surface = "map";
    inspectorParked = false;
    syncSurface();
  }

  function peek(target: EntityTarget, snapshot?: Snapshot, context?: string): void {
    void enterReading(
      {
        kind: "record",
        target,
        ...(snapshot && target.type === "service" ? { origin: serviceOrigin(snapshot, target.id) } : {}),
        ...(snapshot ? { view: map.captureView().view } : {}),
        ...(context ? { context } : {}),
      },
      editor.isEditing() && !inspectorParked,
    );
  }

  function drawReading(subject: ReadingSubject, view?: RecordSummaryViewContext): void {
    clearReader();
    reading = subject;
    const generation = readerSession;
    const current = (): boolean => generation === readerSession;
    const previous = button("Back", () => {
      if (current()) void back();
    });
    const close = button("Close", () => {
      if (current()) void back(true);
    });
    readingPanel.append(
      el("nav", { class: "related-navigation", "aria-label": "Inspector navigation" }, previous, close),
    );
    readingPanel.setAttribute(
      "aria-label",
      subject.kind === "connection"
        ? "Connection inspector"
        : subject.kind === "notes"
          ? "Note inspector"
          : "Inspect related record",
    );
    const content = el("div", { class: "reader-content" });
    readingPanel.append(content);
    if (subject.kind === "notes") close.remove();
    if (subject.kind === "connection") {
      const source = snapshotFor(subject.view);
      const consumer = resolveService(source, subject.consumer);
      const provider = resolveService(source, subject.provider);
      if (consumer === undefined || provider === undefined) {
        content.append(
          el("h2", { tabindex: "-1" }, "Connection unavailable"),
          el("p", {}, "One of the recorded endpoints is no longer available in this perspective."),
        );
      } else {
        const row = {
          consumerServiceId: consumer,
          providerServiceId: provider,
          viaCdsId: subject.pendingRoute ?? null,
        };
        const snapshot =
          subject.scope === "pending"
            ? {
                ...source,
                dependencies: [
                  row,
                  ...source.dependencies.filter(
                    (d) => d.consumerServiceId !== consumer || d.providerServiceId !== provider,
                  ),
                ],
              }
            : source;
        renderConnection(content, subject, snapshot, current, consumer, provider);
      }
    } else if (subject.kind === "notes") {
      notesController = mountAssessmentNotes(
        content,
        repo,
        (pending) => {
          recordNoteDraft = pending;
          onDraftChanged();
        },
        subject.scope,
        {
          ...(subject.position ? { position: subject.position } : {}),
          recordedPerspective: map.captureView().view.kind === "as-is",
          inspect: async (target, position, aspect) => {
            if (!current() || !(await prepareNavigation()) || !current()) return false;
            if (pendingReturn) pendingReturn.reading = { ...subject, position };
            const destination = resolveNoteTarget(repo, target);
            if (!destination) {
              pendingReturn = null;
              setNavigationStatus("This note is detached. Its recorded subject is unavailable.");
              return false;
            }
            map.showAsIs();
            if (destination.kind === "service") {
              await open("service", destination.serviceId);
              const section =
                aspect === "Dependencies" || aspect === "Consumers"
                  ? "connections"
                  : aspect.includes("support") || aspect === "Provider"
                    ? "support"
                    : "overview";
              editor.inspect("service", destination.serviceId, section);
              setNavigationStatus(`Recorded service assertion · ${aspect}`);
              map.reveal("service", destination.serviceId);
            } else if (destination.kind === "service_dependency") {
              await enterReading({
                kind: "connection",
                consumer: { kind: "baseline", serviceId: destination.consumerServiceId },
                provider: { kind: "baseline", serviceId: destination.providerServiceId },
                readOnly: false,
              });
              map.revealDependency(destination.consumerServiceId, destination.providerServiceId);
            } else await enterReading({ kind: "assertion", target });
            return true;
          },
        },
        () => {
          if (current()) void back();
        },
      );
    } else if (subject.kind === "assertion") {
      const dest = resolveNoteTarget(repo, subject.target);
      content.append(
        el("h2", { tabindex: "-1" }, dest?.kind === "assessment" ? "Assessment scope" : "Recorded consumption"),
      );
      if (dest?.kind === "assessment")
        content.append(el("p", {}, repo.assessmentContext().scope || "No assessment scope recorded."));
      else if (dest?.kind === "org_consumes") {
        const service = repo.getService(dest.serviceId);
        const organization = repo.getOrganization(dest.orgId);
        content.append(
          el(
            "p",
            {},
            `${organization?.name ?? "Unavailable organization"} consumes ${service?.name ?? "Unavailable service"} (${service ? (repo.getNetwork(service.networkId)?.name ?? "Unavailable network") : "Unavailable network"}).`,
          ),
          button("Inspect recorded organization", () => {
            if (current()) peek({ type: "organization", id: dest.orgId });
          }),
          button("Show service on map", () => {
            if (current())
              showOnMap(
                () => map.revealOrigin({ kind: "baseline", entity: "service", entityId: dest.serviceId }),
                "This service is no longer available.",
              );
          }),
          button("Inspect consumed service", () => {
            if (current()) peek({ type: "service", id: dest.serviceId });
          }),
        );
      } else content.append(el("p", {}, "This assertion is no longer available."));
    } else if (subject.kind === "unavailable") {
      content.append(el("h2", { tabindex: "-1" }, "Subject unavailable in this view"), el("p", {}, subject.message));
      if (subject.origin) {
        const origin = subject.origin;
        content.append(
          button("Reveal subject on map", () => {
            if (current()) {
              const previous = captureNavigation();
              if (map.revealOrigin(origin)) {
                pendingReturn = previous;
                restoringOrigin = true;
                rememberReturn();
                map.inspectOrigin(origin);
              } else setNavigationStatus("The subject is absent from this perspective. Use Back to return.");
            }
          }),
        );
      }
    } else {
      let { target } = subject;
      if (target.type === "scenario" && target.changeId !== undefined) {
        const changes = repo.listScenarioChanges(target.id);
        const change = changes.find((row) => row.id === target.changeId);
        content.dataset["scenarioChangeId"] = String(target.changeId);
        content.append(
          el("h2", { tabindex: "-1" }, "Scenario change"),
          el("p", {}, change ? describeChange(repo, change, changes) : "This scenario change is no longer available."),
        );
        if (change) {
          const origin: GraphOrigin =
            change.kind === "add"
              ? { kind: "planned", entity: "service", scenarioId: change.scenarioId, changeId: change.id }
              : { kind: "baseline", entity: "service", entityId: change.serviceId };
          const chosenView = map.captureView().view;
          const selecting = chosenView.kind === "compare" && chosenView.scenarioId === change.scenarioId;
          const active = selecting ? map.selectOrigin(origin) : null;
          if (active === "hidden")
            content.append(
              el(
                "p",
                {},
                "This subject is hidden by the current map scope. Show subject on map reveals it. Back restores the prior scope.",
              ),
            );
          const base = repo.snapshot();
          const projected = applyScenario(base, change.scenarioId);
          const sourceId = change.kind === "add" ? null : change.serviceId;
          const destinationId =
            change.kind === "add"
              ? projected.projection.plannedServiceIds.get(change.id)
              : change.kind === "merge"
                ? (change.intoServiceId ??
                  (change.intoChangeId !== null
                    ? projected.projection.plannedServiceIds.get(change.intoChangeId)
                    : null))
                : change.kind === "retire"
                  ? null
                  : change.serviceId;
          function stateFacts(label: string, snapshot: Snapshot, id: number | null | undefined): HTMLElement {
            const service = snapshot.services.find((row) => row.id === id);
            if (!service) return el("p", {}, label + " · Service absent");
            const network =
              snapshot.networks.find((row) => row.id === service.networkId)?.name ?? "Network unavailable";
            const provider =
              snapshot.organizations.find((row) => row.id === service.providerOrgId)?.name ?? "No provider recorded";
            const outgoing = snapshot.dependencies.filter((row) => row.consumerServiceId === id);
            const incoming = snapshot.dependencies.filter((row) => row.providerServiceId === id);
            return el(
              "p",
              {},
              `${label} · ${service.name} (${network}) · ${provider} · ${String(outgoing.length)} outgoing and ${String(incoming.length)} incoming dependencies.`,
            );
          }
          content.append(
            stateFacts("As-Is", base, sourceId),
            stateFacts(change.kind === "merge" ? "Proposed destination" : "To-Be", projected, destinationId),
          );
          content.append(
            el(
              "p",
              {},
              change.kind === "add"
                ? "Proposed addition. This service has no As-Is record."
                : change.kind === "retire"
                  ? "Recorded in As-Is and removed from To-Be."
                  : change.kind === "merge"
                    ? "The proposed merge removes the source and redirects its recorded dependencies to the destination."
                    : "The service retains its recorded identity in its proposed network.",
            ),
            button("Show subject on map", () => {
              if (current() && !map.revealOrigin(origin))
                setNavigationStatus("This subject is unavailable in the current perspective.");
            }),
          );
          if (change.kind === "merge") {
            const destination: GraphOrigin | null =
              change.intoChangeId !== null
                ? { kind: "planned", entity: "service", scenarioId: change.scenarioId, changeId: change.intoChangeId }
                : change.intoServiceId !== null
                  ? { kind: "baseline", entity: "service", entityId: change.intoServiceId }
                  : null;
            if (destination)
              content.append(
                button("Show merge destination", () => {
                  if (current() && !map.revealOrigin(destination))
                    setNavigationStatus("The merge destination is unavailable in this view.");
                }),
              );
          }
          for (const revise of [false, true])
            content.append(
              button(revise ? "Edit change" : "Review in scenario editor", () => {
                void (async () => {
                  if (!current()) return;
                  if (
                    editor.isEditing() &&
                    editor.selection()?.type === "scenario" &&
                    editor.selection()?.id === target.id
                  )
                    await back();
                  else await open("scenario", target.id, true);
                  if (!reading && editor.selection()?.type === "scenario" && editor.selection()?.id === target.id) {
                    if (revise) editor.editScenarioChange(change.id);
                    else editor.revealScenarioChange(change.id);
                  }
                })();
              }),
            );
        }
      } else {
        const snapshot = subject.view ? snapshotFor(subject.view) : undefined;
        if (subject.origin && snapshot) {
          const id = resolveService(snapshot, subject.origin);
          if (id === undefined) {
            drawReading({
              kind: "unavailable",
              origin: null,
              message: "The previous service is no longer available in this perspective.",
            });
            return;
          }
          target = { type: "service", id };
        }
        const summary = createRecordSummary({
          repo,
          target,
          ...(view ? { initialView: view } : {}),
          ...(snapshot ? { snapshot, readOnly: true } : {}),
          ...(subject.context ? { context: subject.context } : {}),
          onNavigate: (next) => {
            if (current()) peek(next, snapshot, subject.context);
          },
          onEdit: (section) => {
            if (current()) void open(target.type, target.id, true, editSection(section));
          },
          ...(!snapshot && target.type === "service"
            ? {
                onAssessment: () => {
                  if (current()) serviceNotes(target.id);
                },
              }
            : {}),
          onDependency: (consumer, provider) => {
            if (current())
              inspectConnection(consumer, provider, snapshot ?? repo.snapshot(), Boolean(snapshot), subject.context);
          },
        });
        content.append(summary);
        if (view) restoreRecordSummaryView(summary, view, { focus: true });
      }
    }
    syncSurface();
    if (subject.kind === "notes") {
      notesController?.focus();
      return;
    }
    const heading = content.querySelector<HTMLElement>("h2");
    if (heading && !view) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  function renderConnection(
    panel: HTMLElement,
    subject: Extract<ReadingSubject, { kind: "connection" }>,
    projected: Snapshot,
    current: () => boolean,
    consumer: number,
    provider: number,
  ): void {
    const { readOnly, scope, label: stateLabel } = subject;
    const row = projected.dependencies.find(
      (d) => d.consumerServiceId === consumer && d.providerServiceId === provider,
    );
    if (!row) {
      panel.append(
        el("h2", { tabindex: "-1" }, "Connection unavailable"),
        el("p", {}, "That connection is no longer available in this view."),
      );
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
            return change ? describeChange(repo, change, projected.scenarioChanges) : "originating change unavailable";
          })()}`
        : `Recorded service: ${qualify(origin.serviceId)}`;
    };
    const qualify = (id: number): string => {
      const s = projected.services.find((item) => item.id === id);
      return `${s?.name ?? "Unavailable"} (${projected.networks.find((n) => n.id === s?.networkId)?.name ?? "Unknown network"})`;
    };

    panel.append(
      el("header", { class: "connection-heading" }, el("h2", {}, stateLabel ?? "Recorded dependency")),
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
                  button(`Review: ${describeChange(repo, change, projected.scenarioChanges)}`, () => {
                    if (current()) peek({ type: "scenario", id: projection.scenarioId, changeId });
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
            if (!current()) return;
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
    );

    if (scope !== "pending")
      panel.append(
        button("Show connection on map", () => {
          if (current())
            showOnMap(
              () => map.revealDependency(consumer, provider),
              "This connection is not represented in the current view.",
            );
        }),
      );
    if (!readOnly) {
      const exchange = repo.exchangeIdentities("service_dependency").get(`${String(consumer)}:${String(provider)}`);
      const target = repo.assessmentTargets().find((row) => row.kind === "service_dependency" && row.id === exchange);
      if (target)
        panel.append(
          button("Evidence and questions for this connection", () => {
            if (current()) void enterReading({ kind: "notes", scope: target });
          }),
        );
    }
  }

  function chooseDraftAction(
    kind: "navigate" | "history" | "import" | "capture" | "export",
  ): Promise<"apply" | "discard" | "stay"> {
    return new Promise((resolve) => {
      const dialog = el("dialog", { class: "confirmation-dialog", "aria-label": "Unapplied changes" });
      const title =
        kind === "capture"
          ? `Capture the current map? ${editor.pendingDraftLabel()} is pending.`
          : kind === "export"
            ? `Export the assessment? ${editor.pendingDraftLabel()} is pending.`
            : `${editor.pendingDraftLabel()} is pending. Choose how to continue.`;
      const choices: readonly [string, "apply" | "discard"][] =
        kind === "history"
          ? [["Discard draft and continue", "discard"]]
          : kind === "capture"
            ? [
                ["Apply and capture", "apply"],
                ["Capture current view", "discard"],
              ]
            : kind === "export"
              ? [
                  ["Apply and export", "apply"],
                  ["Export current recorded state", "discard"],
                ]
              : [
                  ["Apply and continue", "apply"],
                  ["Discard and continue", "discard"],
                ];
      const settle = (choice: "apply" | "discard" | "stay"): void => {
        dialog.close();
        dialog.remove();
        resolve(choice);
      };
      const panel = assessmentPanel(
        dialog,
        el("h2", {}, "Unapplied changes"),
        () => {
          settle("stay");
        },
        el("p", {}, title),
        el(
          "div",
          { class: "confirmation-choices" },
          ...choices.map(([label, choice]) =>
            button(label, () => {
              settle(choice);
            }),
          ),
        ),
      );
      panel.dismiss.textContent =
        kind === "history" ? "Keep editing" : kind === "capture" || kind === "export" ? "Cancel" : "Stay";
      dialog.addEventListener("cancel", panel.cancel);
      document.body.append(dialog);
      dialog.showModal();
      panel.dismiss.focus();
    });
  }

  function applyActiveDraft(): boolean {
    const owner = editor.activeDraftId();
    const applied = editor.applyActiveDraft();
    if (!applied) {
      clearReader();
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

  async function resolveActiveDraft(
    kind: "navigate" | "history" | "import" | "capture" | "export",
    request = ++navigationRequest,
  ): Promise<boolean> {
    if (!editor.hasPendingDraft()) return true;
    const owner = repo;
    const session = sessionId;
    const token = draftToken;
    const choice = await chooseDraftAction(kind);
    if (repo !== owner || sessionId !== session || draftToken !== token || request !== navigationRequest) return false;
    if (choice === "stay") return false;
    if (choice === "apply") {
      if (!applyActiveDraft()) return false;
      if (kind === "capture" || kind === "export") await map.settlePendingPlacement();
      return true;
    }
    if (kind !== "capture" && kind !== "export") editor.discardActiveDraft();
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
      surface === "map"
        ? map.element.querySelector<HTMLElement>("#map-find")
        : list.viewContext().collapsed
          ? list.element.querySelector<HTMLElement>(".list-toggle")
          : (list.element.querySelector<HTMLElement>('[aria-current="true"]') ??
            list.element.querySelector<HTMLElement>("#list-filter"));
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
      !reading &&
      !pendingReturn?.decision &&
      editor.selection()?.type === type &&
      editor.selection()?.id === id &&
      !projectedOrigin &&
      (!edit || editor.isEditing())
    ) {
      pendingReturn = null;
      inspectorParked = false;
      if (!applyRefusal) setNavigationStatus("");
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
    const editingPreview =
      edit && reading?.kind === "record" && reading.target.type === type && reading.target.id === id;
    if (editingPreview) pendingReturn = null;
    else rememberReturn();
    clearReader();
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

  function reconcileMapSubject(origin: GraphOrigin | null, scopeOnly = false): void {
    const before = pendingReturn;
    const selected = before?.selection;
    const reader = before?.reading;
    let readerOrigin: GraphOrigin | null = null;
    if (reader?.kind === "unavailable") readerOrigin = reader.origin;
    if (reader?.kind === "record") {
      const { origin, target } = reader;
      if (origin?.kind === "planned") readerOrigin = { ...origin, entity: "service" };
      else if (origin) readerOrigin = { kind: "baseline", entity: "service", entityId: origin.serviceId };
      else if (target.type === "service" || target.type === "network" || target.type === "cds")
        readerOrigin = { kind: "baseline", entity: target.type, entityId: target.id };
    }
    const subject =
      readerOrigin ??
      before?.origin ??
      (selected?.id != null
        ? selected.type === "service" || selected.type === "network" || selected.type === "cds"
          ? { kind: "baseline" as const, entity: selected.type, entityId: selected.id }
          : null
        : origin);
    if (scopeOnly && (!subject || map.selectOrigin(subject) === "selected")) {
      pendingReturn = null;
      syncSurface();
      return;
    }
    rememberReturn();
    clearReader();
    if (!subject) {
      editor.close();
      projectedOrigin = null;
      syncSurface();
      return;
    }
    restoringOrigin = true;
    if (map.inspectOrigin(subject)) return;
    restoringOrigin = false;
    projectedOrigin = null;
    editor.close();
    const view = map.captureView().view;
    const change =
      view.kind !== "as-is" && subject.kind === "baseline" && subject.entity === "service"
        ? repo
            .listScenarioChanges(view.scenarioId)
            .find(
              (row) =>
                row.kind !== "add" &&
                row.serviceId === subject.entityId &&
                (row.kind === "retire" || row.kind === "merge"),
            )
        : undefined;
    const message =
      subject.kind === "planned" && (view.kind === "as-is" || view.scenarioId !== subject.scenarioId)
        ? "This planned service belongs to another perspective."
        : change
          ? describeChange(repo, change, repo.listScenarioChanges(change.scenarioId))
          : "The selected record is hidden by the current scope or is no longer present.";
    inspectorParked = false;
    drawReading({ kind: "unavailable", origin: subject, message });
  }

  const editor = createEditor({
    repo: () => repo,
    requestCloseInspector: returnToResults,
    selectionChanged: () => {
      list.render();
      syncSurface();
    },
    draftResolved: resolveDraftFeedback,
    draftChanged: () => {
      draftToken++;
      onDraftChanged();
    },
    requestAssessment: (id) => {
      serviceNotes(id);
    },
    requestServiceOnNetwork: (networkId) => {
      void openServiceOnNetwork(networkId);
    },
    requestNavigate: (target, intent) => {
      if (intent === "peek") peek(target);
      else void open(target.type, target.id, true, target.type === "service" ? "connections" : undefined);
    },
    requestCancel: () => {
      void cancelEditing();
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
    describeProposal: (change, all) => describeChange(repo, change, all),
    resolveNavigation: async () => {
      const accepted = await prepareNavigation();
      return accepted;
    },
    navigationAborted: () => {
      pendingReturn = null;
    },
    projectionChanged: (origin) => {
      surface = "map";
      reconcileMapSubject(origin);
    },
    scopeChanged: (origin) => {
      reconcileMapSubject(origin, true);
    },
    inspectProposal: (change) => {
      void enterReading({ kind: "record", target: { type: "scenario", id: change.scenarioId, changeId: change.id } });
    },
    saveView: () => {
      showViewpoints("new");
    },
    inspectDependency: (inspectConnection = (
      consumer,
      provider,
      source,
      readOnly,
      label?: string,
      scope?: "pending" | "recorded" | "projected",
    ) => {
      const pendingRoute = source.dependencies.find(
        (row) => row.consumerServiceId === consumer && row.providerServiceId === provider,
      )?.viaCdsId;
      void enterReading(
        {
          kind: "connection",
          consumer: serviceOrigin(source, consumer),
          provider: serviceOrigin(source, provider),
          readOnly,
          ...(label ? { label } : {}),
          ...(scope ? { scope } : {}),
          ...("projection" in source ? { view: map.captureView().view } : {}),
          ...(pendingRoute !== undefined ? { pendingRoute } : {}),
        },
        scope === "pending",
      );
    }),
    exchangeIdentities: (table) => repo.exchangeIdentities(table),
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
      if (restoringOrigin) {
        restoringOrigin = false;
        clearReader();
        projectedOrigin = null;
        inspectorParked = false;
        editor.inspect(type, id);
        list.reveal(type);
        syncSurface();
        return;
      }
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
        clearReader();
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
  let inspectorExpanded = false;
  const sizeToggle = button(
    "Expand inspector",
    () => {
      inspectorExpanded = !inspectorExpanded;
      syncSurface();
    },
    { class: "inspector-size-toggle", "aria-expanded": "false" },
  );
  const element = el("main", { class: "workspace" }, list.element, map.element, editor.element, readingPanel);
  const inventoryButton = button(
    "Inventory",
    () => {
      inspectorParked = editor.selection() !== null || projectedOrigin !== null || reading !== null;
      surface = "inventory";
      syncSurface();
    },
    { "data-atlas-action": "inventory" },
  );
  function showMap(): void {
    inspectorParked = editor.selection() !== null || projectedOrigin !== null || reading !== null;
    surface = "map";
    syncSurface();
  }
  const mapButton = button("Map", showMap, { "data-atlas-action": "map" });
  const findButton = button(
    "Find anything",
    () => {
      openFind();
    },
    {
      "data-atlas-action": "find",
      "aria-keyshortcuts": "Control+K Meta+K",
      title: "Find anything (Ctrl+K or ⌘K)",
    },
  );

  function openFind(resume?: FindReturn): void {
    if (document.querySelector("dialog[open]") || (reading?.kind === "notes" && !inspectorParked)) return;
    const owner = repo;
    const session = sessionId;
    const revision = repo.currentRevision();
    const source = surface;
    const sourceMap = source === "map" ? map.captureView() : null;
    const from =
      !resume && document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : findButton;
    const records: readonly FindRecord[] =
      surface === "map"
        ? map.findRecords()
        : inventoryRecords(repo.snapshot()).map(({ target, label, detail, searchText }) => ({
            value: `${target.type}:${String(target.id)}`,
            label,
            detail,
            ...(searchText ? { searchText } : {}),
            inspect: async () => {
              if (!(await prepareNavigation())) return false;
              await open(target.type, target.id);
              return true;
            },
          }));
    activeFind = openAtlasFind(
      records,
      from,
      () => owner === repo && session === sessionId && revision === repo.currentRevision(),
      (position) => {
        if (owner !== repo || session !== sessionId) return;
        findReturn = { position, surface: source, map: sourceMap };
        editor.element.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
      },
      () => {
        activeFind = null;
      },
      resume?.position,
    );
  }

  document.addEventListener("keydown", (event) => {
    if (
      event.key.toLowerCase() !== "k" ||
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.isComposing
    )
      return;
    event.preventDefault();
    if (!event.repeat) openFind();
  });
  const viewpointsButton = button("Saved views", () => {
    showViewpoints("list");
  });
  function showViewpoints(startAt: "list" | "new"): void {
    const dialog = manageViewpoints(
      repo,
      () => map.captureViewpoint(),
      async (row) => {
        if (!(await prepareNavigation())) return false;
        const previous = pendingReturn ?? captureNavigation();
        pendingReturn = null;
        surface = "map";
        syncSurface();
        const resized = map.restoreViewpoint(row.definition);
        pendingReturn = previous;
        rememberReturn();
        clearReader();
        editor.close();
        projectedOrigin = null;
        surface = "map";
        inspectorParked = false;
        const selected = map.selectedOrigin();
        if (selected) {
          restoringOrigin = true;
          if (!map.inspectOrigin(selected)) restoringOrigin = false;
        }
        setNavigationStatus(`Restored ${row.name}.${resized ? " Framing was adjusted for this window." : ""}`);
        syncSurface();
        return true;
      },
      (pending) => {
        viewpointDraft = pending;
        onDraftChanged();
      },
      startAt,
    );
    inspectionDialogs.add(dialog);
    dialog.addEventListener("close", () => inspectionDialogs.delete(dialog), { once: true });
  }
  function showDecisionViews(previous?: DecisionPosition): void {
    try {
      const mapState = surface === "map" ? map.assessmentView(false) : undefined;
      const output = freezeAssessment(
        repo,
        {
          generated: new Date().toISOString(),
          schema: LATEST_VERSION,
          build: BUILD,
          fileState: captureUnsaved() ? "Changes not saved to file" : "Saved",
        },
        mapState,
      );
      const owner = repo;
      const dialog = openDecisionViews(
        output,
        (service, position, leave) => {
          void (async () => {
            if (repo !== owner || !(await prepareNavigation()) || repo !== owner) return;
            leave();
            if (pendingReturn) pendingReturn.decision = position;
            const baselineId = [...repo.exchangeIdentities("service")].find(
              ([, identity]) => identity === service.id,
            )?.[0];
            if (position.view === "As-Is") {
              if (baselineId === undefined) {
                pendingReturn = null;
                setNavigationStatus("That recorded service no longer exists.");
                return;
              }
              await open("service", Number(baselineId));
              return;
            }
            const shown = map.captureView().view;
            if (shown.kind === "as-is") {
              pendingReturn = null;
              setNavigationStatus("The selected proposal is no longer open.");
              return;
            }
            const plannedId = [...repo.exchangeIdentities("scenario_change")].find(
              ([, identity]) => identity === service.id,
            )?.[0];
            if (shown.kind === "compare")
              map.restoreView({ ...map.captureView(), view: { kind: "to-be", scenarioId: shown.scenarioId } });
            const found =
              baselineId !== undefined
                ? map.inspectOrigin({ kind: "baseline", entity: "service", entityId: Number(baselineId) })
                : plannedId !== undefined &&
                  map.inspectOrigin({
                    kind: "planned",
                    entity: "service",
                    scenarioId: shown.scenarioId,
                    changeId: Number(plannedId),
                  });
            if (!found) {
              pendingReturn = null;
              setNavigationStatus("That proposed service is no longer available.");
            }
          })();
        },
        previous,
        mapState?.scopeNotes,
      );
      inspectionDialogs.add(dialog);
      dialog.addEventListener("close", () => inspectionDialogs.delete(dialog), { once: true });
    } catch (error) {
      setNavigationStatus(error instanceof Error ? error.message : "Could not open decision views.");
    }
  }

  const batchButton = button("Batch assignments", () => {
    void (async () => {
      const owner = repo;
      const request = ++navigationRequest;
      if (!(await resolveActiveDraft("navigate", request)) || repo !== owner || request !== navigationRequest) return;
      const dialog = openBatchAssignment(
        repo,
        (count) => {
          setNavigationStatus(
            `${String(count)} service assignment${count === 1 ? "" : "s"} changed. Save file to keep them.`,
          );
        },
        (pending) => {
          batchDraft = pending;
        },
      );
      inspectionDialogs.add(dialog);
      dialog.addEventListener("close", () => inspectionDialogs.delete(dialog), { once: true });
    })();
  });

  const decisionButton = button("Decision views", () => {
    showDecisionViews();
  });
  const editPerspective = el("div", { hidden: "" }, el("span", {}, "Map perspective"));
  const perspectiveControl = map.element.querySelector<HTMLElement>(".map-perspective");
  const perspectiveHome = perspectiveControl?.parentElement;
  const assessmentActions = el(
    "details",
    { class: "workspace-assessment" },
    el("summary", {}, "Assessment"),
    el(
      "div",
      { class: "file-menu-actions" },
      button("Evidence and questions", () => {
        void enterReading({ kind: "notes" });
      }),
      decisionButton,
      viewpointsButton,
      batchButton,
      editPerspective,
    ),
  );
  async function cancelEditing(): Promise<void> {
    const previous = editor.selection();
    const draft = editor.activeDraftId();
    const section = readSection(editor.viewContext().section);
    const origin = navigationHistory.at(-1);
    const owner = repo;
    const session = sessionId;
    const request = ++navigationRequest;
    if (
      !(await resolveActiveDraft("navigate", request)) ||
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
  }
  function returnToResults(): void {
    if (!findReturn && navigationHistory.at(-1)?.decision) {
      void back();
      return;
    }
    if (reading || navigationHistory.at(-1)?.reading?.kind === "notes") {
      void back();
      return;
    }
    inspectorParked = true;
    if (findReturn) {
      surface = findReturn.surface;
      syncSurface();
      if (findReturn.map) map.restoreView(findReturn.map);
      openFind(findReturn);
      return;
    }
    syncSurface();
    focusResults();
  }
  const returnButton = button("Return to results", returnToResults, { "data-atlas-action": "return" });
  const returnToEditor = button(
    "Return to draft",
    () => {
      inspectorParked = false;
      syncSurface();
      if (editorFocus?.isConnected) editorFocus.focus({ preventScroll: true });
      else editor.element.querySelector<HTMLElement>("input:not([hidden]), button, h2")?.focus();
    },
    { "data-atlas-action": "resume" },
  );
  editor.element.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement) editorFocus = event.target;
  });
  function syncSurface(): void {
    list.element.hidden = surface !== "inventory";
    map.element.hidden = surface !== "map";
    const startHost = surface === "inventory" ? list.element : map.element;
    if (startPanel && startPanel.parentElement !== startHost) startHost.prepend(startPanel);
    inventoryButton.setAttribute("aria-pressed", String(surface === "inventory"));
    mapButton.setAttribute("aria-pressed", String(surface === "map"));
    viewpointsButton.hidden = false;
    batchButton.hidden = surface !== "inventory";
    const selected = (reading !== null || editor.selection() !== null || projectedOrigin !== null) && !inspectorParked;
    readingPanel.hidden = !selected || !reading;
    element.dataset["inspectorExpanded"] = String(inspectorExpanded);
    sizeToggle.hidden = !selected;
    sizeToggle.textContent = inspectorExpanded ? "Collapse inspector" : "Expand inspector";
    sizeToggle.setAttribute("aria-expanded", String(inspectorExpanded));
    backButton.hidden = !!reading && !inspectorParked;
    element.classList.toggle("has-selection", selected);
    const fullEditor = !reading && editor.isEditing() && !inspectorParked;
    element.classList.toggle("editing", fullEditor);
    // The full-width editor hides the map toolbar. Keep the same guarded View control available from Assessment.
    editPerspective.hidden = !fullEditor;
    if (perspectiveControl && perspectiveHome) {
      if (fullEditor && perspectiveControl.parentElement !== editPerspective)
        editPerspective.append(perspectiveControl);
      else if (!fullEditor && perspectiveControl.parentElement !== perspectiveHome)
        perspectiveHome.prepend(perspectiveControl);
    }
    element.dataset["surface"] = surface;
    editor.element.hidden = !selected || !!reading;
    returnButton.hidden = !selected || editor.isEditing() || !!reading;
    returnToEditor.hidden = !inspectorParked || (!reading && editor.selection() === null && projectedOrigin === null);
    returnToEditor.textContent = editor.isEditing() ? "Return to draft" : "Show selected record";
  }
  element.prepend(
    el(
      "nav",
      { class: "workspace-navigation", "aria-label": "Workspace" },
      inventoryButton,
      mapButton,
      findButton,
      assessmentActions,
      backButton,
      returnButton,
      returnToEditor,
      sizeToggle,
    ),
    navigationStatus,
  );
  element.addEventListener("keydown", (event) => {
    if (event.key !== "F2" || editor.isEditing()) return;
    const selection = editor.selection();
    if (selection?.id !== null && selection) {
      event.preventDefault();
      void open(selection.type, selection.id, true, editSection(editor.viewContext().section));
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      (editor.element.hidden && readingPanel.hidden) ||
      !(target instanceof Element) ||
      document.querySelector("dialog[open]") ||
      target.closest("details[open]")
    )
      return;
    if (
      target !== document.body &&
      !editor.element.contains(target) &&
      !readingPanel.contains(target) &&
      !target.closest('.entity-list [aria-current="true"], .map-canvas, .workspace-navigation')
    )
      return;
    if (target instanceof HTMLInputElement && target.type === "search" && target.value) return;
    event.preventDefault();
    if (reading) void back();
    else if (editor.isEditing()) void cancelEditing();
    else returnToResults();
  });

  function setRepository(next: Repository): void {
    activeFind?.close();
    activeFind = null;
    findReturn = null;
    clearReader();
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
        projectedOrigin = null;
        editor.close();
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
    travelHistory: (direction) => {
      const priorMessage = navigationStatus.textContent;
      const changed = direction === "undo" ? repo.undo() : repo.redo();
      if (!changed) return;
      editor.reload();
      if (navigationStatus.textContent === priorMessage)
        setNavigationStatus(direction === "undo" ? "Change undone." : "Change reapplied.");
      if (projectedOrigin && !map.inspectOrigin(projectedOrigin)) {
        projectedOrigin = null;
        editor.close();
        setNavigationStatus("The projected target is no longer available.");
      }
    },
    assessmentView: (includeMap) => {
      if (surface !== "map") throw new Error("Open Map before exporting the current map view.");
      return map.assessmentView(includeMap);
    },
    hasAssessmentDraft: () => viewpointDraft || batchDraft || recordNoteDraft,
    mapIsOpen: () => surface === "map",
    showMap,
    startNetwork: async () => {
      surface = "inventory";
      await open("network", null, true);
      editor.element.querySelector<HTMLInputElement>("#field-name")?.focus();
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
    addAssessmentCommands: (...groups) => {
      assessmentActions.querySelector(".file-menu-actions")?.append(...groups);
    },
    inspectRecord: async (target) => {
      if (target.type === "scenario" && target.changeId !== undefined) peek(target);
      else await open(target.type, target.id);
    },
  };
}
