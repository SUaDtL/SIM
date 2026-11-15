import { SensitiveInputWarning, ValidationError, type DiagnosticTarget } from "../domain/errors";
import type { Repository, ServiceEditBase } from "../domain/repository";
import type { Tier } from "../domain/types";
import type { Snapshot } from "../domain/types";
import type { GraphNode, MapEntity } from "../map/graph";
import { dependencyKey, type Comparison, type ProjectedSnapshot } from "../scenario/scenario";
import { button, el, focusPagingControl, option } from "./dom";
import {
  descriptor,
  type EntityType,
  type FieldDef,
  fieldFor,
  type FormValues,
  nounOf,
  serviceInputFromValues,
  suggestsFoundational,
} from "./forms";
import type { Selection } from "./list-panel";
import { createScenarioChanges, type ScenarioChangeBuilder } from "./scenario-changes";
import {
  captureRecordSummaryView,
  createRecordSummary,
  restoreRecordSummaryView,
  type RecordSummaryViewContext,
  type SummarySection,
} from "./record-summary";
import { openReferencePicker } from "./reference-picker";
import { collectionPage } from "./relationship-collection";

export interface EditorContext {
  repo(): Repository;
  /** The editor opened, saved or closed an item; the list should update its highlight. */
  selectionChanged(): void;
  draftChanged?(): void;
  requestServiceOnNetwork?(networkId: number): void;
  requestNavigate?(target: { type: EntityType; id: number }, intent: "peek" | "edit"): void;
  requestDependency?(consumer: number, provider: number): void;
  requestCancel?(): void;
  requestSimilar?(sourceId: number): void;
  /** Successful guarded deletion has closed the editor and any confirmation modal. */
  recordDeleted?(type: EntityType, id: number): void;
}

interface EditorViewContext {
  editing: boolean;
  section: string;
  scrollTop: number;
  summary: RecordSummaryViewContext | undefined;
}

export interface EditorPanel {
  readonly element: HTMLElement;
  selection(): Selection | null;
  open(type: EntityType, id: number | null, section?: "details" | "connections" | "support"): void;
  inspect(type: EntityType, id: number, section?: SummarySection): void;
  createSimilar(sourceId: number): void;
  isEditing(): boolean;
  viewContext(): EditorViewContext;
  restoreViewContext(context: EditorViewContext): void;
  close(): void;
  /** The dataset changed: refresh relationship rows, keeping any text the user is typing. */
  refresh(): void;
  /** Undo or redo changed the data under the form: rebuild it, or close if its item is gone. */
  reload(): void;
  hasPendingDraft(): boolean;
  pendingDraftLabel(): string;
  applyActiveDraft(): boolean;
  discardActiveDraft(): void;
  inspectProjected(
    node: GraphNode,
    view: { kind: "to-be" | "compare"; scenarioId: number },
    projected: Snapshot,
    comparison: Comparison | null,
    actions: { editAsIs(entity: MapEntity, id: number): void; openScenario(id: number): void },
  ): void;
  openServiceOnNetwork(networkId: number): void;
}

const TIERS: readonly Tier[] = [1, 2, 3];

function describe(error: unknown): string {
  if (error instanceof ValidationError || error instanceof SensitiveInputWarning) return error.message;
  return "Something went wrong; nothing was changed.";
}

export function createEditor(ctx: EditorContext): EditorPanel {
  const element = el("aside", { class: "editor", "data-testid": "editor", "aria-label": "Editor" });
  let current: Selection | null = null;
  let relations: HTMLElement | null = null;
  let collectCurrent: (() => FormValues) | null = null;
  let baseValues: FormValues | null = null;
  let applyCurrent: (() => boolean) | null = null;
  let reportExternalChange: ((reason: "changed" | "deleted") => void) | null = null;
  let serviceBase: ServiceEditBase | null = null;
  let scenarioBuilder: ScenarioChangeBuilder | null = null;
  let activePicker: ReturnType<typeof openReferencePicker> | null = null;
  let editing = false;
  let activeSection = "details";
  const relationViews = new Map<string, { query: string; page: number }>();
  let sectionErrors = new Set<string>();
  function showSection(section: string): void {
    activeSection = section;
    for (const panel of element.querySelectorAll<HTMLElement>("[data-editor-section]"))
      panel.hidden = panel.dataset["editorSection"] !== section;
    for (const tab of element.querySelectorAll<HTMLButtonElement>("[data-edit-section]")) {
      const selected = tab.dataset["editSection"] === section;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const key = tab.dataset["editSection"] ?? "details";
      tab.textContent = `${key[0]?.toUpperCase() ?? ""}${key.slice(1)}${sectionErrors.has(key) ? " (error)" : ""}`;
    }
  }

  function inspect(
    type: EntityType,
    id: number,
    notice = "",
    section?: SummarySection,
    notify = true,
    initialView?: RecordSummaryViewContext,
  ): void {
    const focusRequested = section !== undefined || notice !== "";
    const previousSection =
      type === "service" && current?.type === "service" && !editing
        ? captureRecordSummaryView(element.querySelector<HTMLElement>(".record-summary") ?? element)?.section
        : undefined;
    section ??= previousSection ?? "overview";
    activePicker?.close();
    activePicker = null;
    editing = false;
    element.dataset["mode"] = "read";
    current = { type, id };
    relations = null;
    collectCurrent = null;
    baseValues = null;
    applyCurrent = null;
    serviceBase = null;
    serviceDraft = null;
    scenarioBuilder = null;
    relationIntent = { consumer: "", provider: "", via: "", touched: false };
    const summary = createRecordSummary({
      repo: ctx.repo(),
      target: { type, id },
      initialSection: section,
      ...(initialView ? { initialView } : {}),
      onNavigate: (target) => {
        ctx.requestNavigate?.(target, "peek");
      },
      onEdit: (section) => {
        open(type, id, "", section === "overview" || !section ? "details" : section);
      },
      onDependency: (consumer, provider) => {
        ctx.requestDependency?.(consumer, provider);
      },
      ...(type === "service"
        ? {
            onSimilar: () => {
              ctx.requestSimilar?.(id);
            },
          }
        : {}),
      onDelete: () => {
        const trigger = element.querySelector<HTMLElement>("details.record-secondary-actions > summary");
        const dialog = el("dialog", { "aria-label": `Delete ${nounOf(type)}` });
        const message = el("p", { role: "alert" });
        let cleaned = false;
        const cleanup = (): void => {
          if (cleaned) return;
          cleaned = true;
          dialog.remove();
          if (trigger?.isConnected) trigger.focus();
        };
        const finish = (): void => {
          dialog.close();
          cleanup();
        };
        const control = deleteControl(type, id, nounOf(type), message, { afterDelete: finish, cancel: finish });
        dialog.append(el("h2", {}, `Delete ${nounOf(type)}`), control, message, button("Close", finish));
        dialog.addEventListener("cancel", (event) => {
          event.preventDefault();
          finish();
        });
        dialog.addEventListener("close", cleanup, { once: true });
        document.body.append(dialog);
        dialog.showModal();
      },
    });
    if (type === "network")
      summary.append(
        button("Add service on this network", () => {
          ctx.requestServiceOnNetwork?.(id);
        }),
      );
    const completion = el("p", { role: "status", class: "notice" }, notice);
    (summary.querySelector(".record-summary-heading") ?? summary).append(completion);
    element.replaceChildren(summary);
    if (initialView) restoreRecordSummaryView(summary, initialView);
    ctx.selectionChanged();
    if (notify) draftChanged();
    if (notify && focusRequested) focusSection();
  }

  function focusSection(): void {
    element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }

  function readSection(): SummarySection {
    return activeSection === "support" || activeSection === "connections" ? activeSection : "overview";
  }

  function createSimilar(sourceId: number): void {
    const repo = ctx.repo();
    const source = repo.getService(sourceId);
    if (!source) return;
    const sourceValues = descriptor("service").values(repo, sourceId);
    const sourceSupport = repo.listSupport().filter((row) => row.serviceId === sourceId);
    open("service", null);
    for (const [key, value] of Object.entries(sourceValues)) {
      const control = element.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        `#field-${key}`,
      );
      if (!control) continue;
      if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = value === true;
      else if (typeof value === "string") control.value = value;
    }
    const network = element.querySelector<HTMLSelectElement>("#field-networkId");
    if (network) {
      network.prepend(option("", "Choose destination network"));
      network.value = "";
      network.dispatchEvent(new Event("change", { bubbles: true }));
    }
    for (const key of ["marking", "foundational"])
      element.querySelector(`#field-${key}`)?.dispatchEvent(new Event("change", { bubbles: true }));
    const copy = el("input", { type: "checkbox", id: "copy-support" });
    copy.addEventListener("change", () => {
      if (serviceDraft)
        serviceDraft.support = copy.checked
          ? sourceSupport.map((row) => ({ tier: row.tier, orgId: row.orgId, notes: row.notes }))
          : [];
      renderRelations();
      draftChanged();
    });
    const reuse = el(
      "section",
      {
        class: "reuse-notice",
        "data-testid": "similar-source",
        "data-source-context": `${source.name} (${repo.getNetwork(source.networkId)?.name ?? "Unavailable"})`,
      },
      el("h3", {}, `Starting from ${source.name}`),
      el(
        "p",
        {},
        "This is a new independent service. Choose its destination network. Shared references are reused; consuming organizations, dependencies, positions and history are not copied. The source stays unchanged.",
      ),
      el("label", { for: "copy-support" }, copy, "Also copy support assignments and notes"),
    );
    element.querySelector('[data-editor-section="details"]')?.prepend(reuse);
    for (const select of element.querySelectorAll<HTMLSelectElement>("select[data-reference]"))
      select.dispatchEvent(new Event("reference-refresh"));
    draftChanged();
  }
  let relationIntent = { consumer: "", provider: "", via: "", touched: false };
  let serviceDraft: {
    support: { tier: Tier; orgId: number; notes: string | null }[];
    consumerOrgIds: number[];
    dependencies: { providerServiceId: number; viaCdsId: number | null }[];
  } | null = null;

  function hasPendingDraft(): boolean {
    if (relationIntent.touched) return true;
    if (scenarioBuilder?.hasPendingIntent()) return true;
    if (!collectCurrent || !baseValues) return false;
    if (JSON.stringify(collectCurrent()) !== JSON.stringify(baseValues)) return true;
    if (serviceDraft) {
      return (
        JSON.stringify(serviceDraft) !==
        JSON.stringify({
          support: serviceBase?.support.map((s) => ({ tier: s.tier, orgId: s.orgId, notes: s.notes })) ?? [],
          consumerOrgIds: [...(serviceBase?.consumerOrgIds ?? [])],
          dependencies:
            serviceBase?.dependencies.map((d) => ({
              providerServiceId: d.providerServiceId,
              viaCdsId: d.viaCdsId,
            })) ?? [],
        })
      );
    }
    return false;
  }

  function pendingDraftLabel(): string {
    return scenarioBuilder?.hasPendingIntent() ? "Unadded scenario change" : "Unapplied changes";
  }

  function draftChanged(): void {
    updateEditingIdentity();
    const status = element.querySelector<HTMLElement>('[data-testid="editor-draft-summary"]');
    if (status) status.textContent = hasPendingDraft() ? "Unapplied draft across all sections" : "No unapplied changes";
    ctx.draftChanged?.();
  }

  function updateEditingIdentity(): void {
    if (!current || !editing) return;
    const identity = element.querySelector<HTMLElement>('[data-testid="editor-identity"]');
    if (!identity) return;
    const name =
      element.querySelector<HTMLInputElement>("#field-name")?.value.trim() || `Unnamed ${nounOf(current.type)}`;
    const networkId = element.querySelector<HTMLSelectElement>("#field-networkId")?.value;
    const network = networkId
      ? (ctx.repo().getNetwork(Number(networkId))?.name ?? "Unavailable network")
      : "Choose destination network";
    const draft = `${name}${current.type === "service" ? ` (${network})` : ""}`;
    if (current.id !== null) {
      const original = typeof baseValues?.["name"] === "string" ? baseValues["name"] : name;
      const saved = current.type === "service" ? ctx.repo().getService(current.id) : null;
      const context = saved ? ` (${ctx.repo().getNetwork(saved.networkId)?.name ?? "Unavailable network"})` : "";
      const qualified = `${original}${context}`;
      identity.textContent = `Editing ${qualified}${draft === qualified ? "" : ` · Draft: ${draft}`}`;
    } else {
      const source = element.querySelector<HTMLElement>('[data-testid="similar-source"]')?.dataset["sourceContext"];
      identity.textContent = `New ${nounOf(current.type)}: ${draft}${source ? ` · Source: ${source}` : ""}`;
    }
  }

  function discardActiveDraft(): void {
    if (!current) return;
    if (current.id !== null && descriptor(current.type).get(ctx.repo(), current.id) === undefined) close();
    else open(current.type, current.id, "Unapplied changes discarded.", activeSection);
  }

  function inspectProjected(
    node: GraphNode,
    view: { kind: "to-be" | "compare"; scenarioId: number },
    projected: Snapshot,
    comparison: Comparison | null,
    actions: { editAsIs(entity: MapEntity, id: number): void; openScenario(id: number): void },
  ): void {
    editing = false;
    element.dataset["mode"] = "projection";
    relationIntent = { consumer: "", provider: "", via: "", touched: false };
    current = null;
    relations = null;
    collectCurrent = null;
    baseValues = null;
    applyCurrent = null;
    reportExternalChange = null;
    serviceBase = null;
    serviceDraft = null;
    scenarioBuilder = null;
    const origin = node.data.origin;
    const scenarioName = projected.scenarios.find((item) => item.id === view.scenarioId)?.name ?? "Scenario";
    const title = node.data.label.split("\n")[0] ?? "Map item";
    const details: HTMLElement[] = [
      el("p", {}, `${view.kind === "compare" ? "Compare" : "To-Be"} projection: ${scenarioName}`),
      el(
        "p",
        {},
        origin.kind === "planned"
          ? "Planned service added by this scenario."
          : "Existing As-Is record in this projection.",
      ),
    ];
    if (node.data.entity === "service") {
      const service = projected.services.find((item) => item.id === node.data.entityId);
      if (service) {
        const network = projected.networks.find((item) => item.id === service.networkId);
        details.push(el("p", {}, `Network: ${network?.name ?? "Unavailable"}; marking: ${service.marking}`));
        const providers = projected.dependencies.filter((item) => item.consumerServiceId === service.id);
        const usedBy = projected.dependencies.filter((item) => item.providerServiceId === service.id);
        const consumers = projected.consumption.filter((item) => item.serviceId === service.id);
        details.push(
          el(
            "p",
            {},
            `${String(providers.length)} outgoing dependencies; Used by ${String(usedBy.length)} ${usedBy.length === 1 ? "service" : "services"}; ${String(consumers.length)} consumer organizations.`,
          ),
        );
        if ("projection" in projected) {
          const provenance = (projected as ProjectedSnapshot).projection;
          const related = projected.dependencies.filter(
            (item) => item.consumerServiceId === service.id || item.providerServiceId === service.id,
          );
          for (const item of related) {
            const route = provenance.dependencyProvenance.get(dependencyKey(item));
            if (route?.status !== "unresolved") continue;
            const previous = route.previousViaCdsIds.map(
              (id) => projected.cds.find((cds) => cds.id === id)?.name ?? String(id),
            );
            details.push(
              el(
                "p",
                { class: "warning" },
                `Unresolved route previously via ${previous.join(", ") || "a CDS"}: ${route.reason ?? "coverage changed"}. Connectivity is unverified.`,
              ),
            );
          }
          const impact = provenance.impacts;
          const dropped = impact.droppedSupport.filter((item) => item.serviceId === service.id).length;
          const transfers = impact.transferredConsumption.filter(
            (item) => item.fromServiceId === service.id || item.toServiceId === service.id,
          ).length;
          const links = impact.transferredDependencies.filter(
            (item) =>
              item.before.consumerServiceId === service.id ||
              item.before.providerServiceId === service.id ||
              item.after.consumerServiceId === service.id ||
              item.after.providerServiceId === service.id,
          ).length;
          if (dropped + transfers + links > 0) {
            details.push(
              el(
                "p",
                {},
                `Projection effects: ${String(dropped)} support assignments dropped; ${String(transfers)} consumer links transferred; ${String(links)} dependencies transferred.`,
              ),
            );
          }
        }
      }
      const status = comparison?.status.get(node.data.entityId);
      if (status) details.push(el("p", {}, `Comparison status: ${status}.`));
    }
    if (comparison) {
      details.push(
        el(
          "p",
          {},
          `Services ${String(comparison.services.asIs)} → ${String(comparison.services.toBe)}; cross-domain dependencies ${String(comparison.crossDomain.asIs)} → ${String(comparison.crossDomain.toBe)}.`,
        ),
      );
      if (node.data.entity === "service") {
        const relatedKeys = new Set(
          projected.dependencies
            .filter(
              (item) => item.consumerServiceId === node.data.entityId || item.providerServiceId === node.data.entityId,
            )
            .map(dependencyKey),
        );
        const changedRoutes = comparison.routeChanges.filter((route) => relatedKeys.has(route.key));
        if (changedRoutes.length > 0) {
          details.push(
            el(
              "p",
              {},
              `${String(changedRoutes.length)} route changes retain their previous and projected CDS references; unresolved routes are not established direct links.`,
            ),
          );
        }
      }
    }
    const actionsRow = el("div", { class: "actions" });
    if (origin.kind === "baseline") {
      actionsRow.append(
        button("Edit As-Is", () => {
          actions.editAsIs(origin.entity, origin.entityId);
        }),
      );
    }
    actionsRow.append(
      button("Open scenario", () => {
        actions.openScenario(view.scenarioId);
      }),
    );
    element.replaceChildren(el("h2", {}, title), ...details, actionsRow);
    ctx.selectionChanged();
    draftChanged();
  }

  function applyActiveDraft(): boolean {
    if (!hasPendingDraft()) return true;
    return applyCurrent?.() ?? true;
  }

  function placeholder(): void {
    element.replaceChildren(
      el("p", { class: "empty" }, "Select an item or add one."),
      button(
        ctx.repo().listNetworks().length === 0 ? "Create first network" : "Create another network",
        () => {
          open("network", null);
        },
        { class: "subtle" },
      ),
    );
  }

  function openServiceOnNetwork(networkId: number): void {
    open("service", null);
    const network = element.querySelector<HTMLSelectElement>("#field-networkId");
    if (!network) return;
    network.value = String(networkId);
    network.dispatchEvent(new Event("change", { bubbles: true }));
    draftChanged();
  }

  function close(): void {
    activePicker?.close();
    activePicker = null;
    editing = false;
    element.dataset["mode"] = "empty";
    relationIntent = { consumer: "", provider: "", via: "", touched: false };
    current = null;
    relations = null;
    collectCurrent = null;
    baseValues = null;
    applyCurrent = null;
    serviceBase = null;
    serviceDraft = null;
    placeholder();
    ctx.selectionChanged();
    draftChanged();
  }

  function open(type: EntityType, id: number | null, noticeText = "", section = "details"): void {
    activePicker?.close();
    activePicker = null;
    editing = true;
    element.dataset["mode"] = "edit";
    activeSection = type === "service" ? section : "details";
    sectionErrors = new Set();
    relationViews.clear();
    relationIntent = { consumer: "", provider: "", via: "", touched: false };
    const repo = ctx.repo();
    const d = descriptor(type);
    const noun = nounOf(type);
    current = { type, id };
    const values = d.values(repo, id);
    baseValues = { ...values };
    serviceBase = type === "service" && id !== null ? repo.readServiceEditBase(id) : null;
    scenarioBuilder = null;
    serviceDraft = serviceBase
      ? {
          support: serviceBase.support.map((s) => ({ tier: s.tier, orgId: s.orgId, notes: s.notes })),
          consumerOrgIds: [...serviceBase.consumerOrgIds],
          dependencies: serviceBase.dependencies.map((dep) => ({
            providerServiceId: dep.providerServiceId,
            viaCdsId: dep.viaCdsId,
          })),
        }
      : type === "service"
        ? { support: [], consumerOrgIds: [], dependencies: [] }
        : null;

    const errors = new Map<string, HTMLElement>();
    const controls = new Map<string, () => FormValues[string]>();
    const fields = d.fields.map((f) => renderField(repo, f, values, id, errors, controls));

    const message = el("p", { class: "message", "data-testid": "editor-message", role: "alert", tabindex: "-1" });
    const reveal = (target: HTMLElement): void => {
      const feedback = target.closest<HTMLElement>('[data-testid="sensitive-warning"]') ?? target;
      feedback.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    };
    const diagnosticActions = el("div", { class: "actions", "data-testid": "editor-diagnostic-actions" });
    const conflictActions = el("div", { class: "actions", "data-testid": "editor-conflict-actions" });
    conflictActions.hidden = true;
    const showExternalChange = (reason: "changed" | "deleted"): void => {
      if (reason === "deleted") {
        message.textContent =
          "This record was deleted while you were editing. Your unapplied input is still here. Close this editor to discard it.";
        conflictActions.replaceChildren(button("Close deleted record", close));
      } else {
        message.textContent =
          "This service or one of its relationships changed. Your unapplied input is still here. Reload current record to review the new version; reloading discards your input.";
        conflictActions.replaceChildren(
          button("Reload current record", () => {
            open(type, id);
          }),
        );
      }
      conflictActions.hidden = false;
    };
    reportExternalChange = showExternalChange;
    const notice = el("p", { class: "notice", role: "status" }, noticeText);
    const warningList = el("ul");
    const warning = el(
      "div",
      { class: "warning", "data-testid": "sensitive-warning", role: "alert" },
      el(
        "p",
        {},
        "These values look like IP addresses or host names. SIM should stay free of host data; save only if you are sure.",
      ),
      warningList,
    );
    warning.hidden = true;
    let pending: FormValues | null = null;
    let pendingSignature: string | null = null;
    const signature = (): string =>
      JSON.stringify([type, id, collect(), serviceDraft, scenarioBuilder?.collectPendingIntent() ?? null]);
    warning.append(
      button(
        "Save anyway",
        () => {
          if (pending && pendingSignature === signature()) save(pending, true);
          else {
            pending = null;
            pendingSignature = null;
            warning.hidden = true;
            message.textContent = "The pending edit changed. Review it and apply again.";
          }
        },
        { class: "danger" },
      ),
    );

    const collect = (): FormValues => {
      const out: FormValues = {};
      for (const [key, read] of controls) out[key] = read();
      return out;
    };
    collectCurrent = collect;
    const clearErrors = (): void => {
      for (const control of element.querySelectorAll('[aria-invalid="true"]')) control.removeAttribute("aria-invalid");
      for (const e of errors.values()) {
        e.textContent = "";
        e.hidden = true;
      }
      message.textContent = "";
      diagnosticActions.replaceChildren();
      conflictActions.hidden = true;
      notice.textContent = "";
      sectionErrors.clear();
      showSection(activeSection);
    };
    const showError = (field: string, text: string, targets: readonly DiagnosticTarget[] = []): void => {
      diagnosticActions.replaceChildren(
        ...targets
          .filter((target) => descriptor(target.type).get(ctx.repo(), target.id) !== undefined)
          .map((target) =>
            button(target.label, () => {
              ctx.requestNavigate?.({ type: target.type, id: target.id }, "peek");
            }),
          ),
      );
      const section = /support|notes/i.test(field)
        ? "support"
        : /via|dependency|consumer/i.test(field)
          ? "connections"
          : "details";
      sectionErrors.add(section);
      showSection(type === "service" ? section : "details");
      const key = fieldFor(type, field);
      const target = key === null ? undefined : errors.get(key);
      if (target) {
        target.textContent = text;
        target.hidden = false;
        const control =
          element.querySelector<HTMLElement>(`#field-${key ?? ""}-choose`) ??
          element.querySelector<HTMLElement>(`#field-${key ?? ""}`);
        control?.setAttribute("aria-invalid", "true");
        if (control) reveal(control);
      } else {
        message.textContent = text;
        reveal(message);
      }
    };

    function save(input: FormValues, confirmSensitive: boolean): boolean {
      clearErrors();
      if (id !== null && descriptor(type).get(ctx.repo(), id) === undefined) {
        showExternalChange("deleted");
        return false;
      }
      try {
        if (type === "scenario" && id !== null && scenarioBuilder) {
          const intent = scenarioBuilder.collectPendingIntent();
          const phase: { value: "metadata" | "builder" } = { value: "metadata" };
          try {
            ctx.repo().atomic(() => {
              d.save(ctx.repo(), id, input, { confirmSensitive });
              if (intent) {
                phase.value = "builder";
                ctx.repo().addScenarioChange(id, intent, { confirmSensitive });
              }
            });
          } catch (error) {
            if (
              phase.value === "builder" &&
              (error instanceof ValidationError || error instanceof SensitiveInputWarning)
            ) {
              const reviewed = signature();
              scenarioBuilder.showError(error, () => {
                if (signature() === reviewed) save(input, true);
                else message.textContent = "The pending edit changed. Review it and apply again.";
              });
              return false;
            }
            throw error;
          }
          inspect(type, id, "Scenario changes applied.");
          return true;
        }
        if (type === "service" && serviceDraft) {
          const draft = {
            fields: serviceInputFromValues(input),
            support: serviceDraft.support,
            consumerOrgIds: serviceDraft.consumerOrgIds,
            dependencies: serviceDraft.dependencies,
          };
          const result =
            id === null
              ? ctx.repo().createServiceDraft(draft, { confirmSensitive })
              : serviceBase
                ? ctx.repo().applyServiceDraft(id, serviceBase, draft, { confirmSensitive })
                : null;
          if (!result) return false;
          if (result.status === "conflict") {
            showExternalChange("changed");
            return false;
          }
          if (result.status === "refused") {
            showError(result.error.field, result.error.message, result.error.targets);
            return false;
          }
          if (result.status === "needs-confirmation") {
            pending = input;
            pendingSignature = signature();
            warningList.replaceChildren(
              ...result.warning.findings.map((f) => el("li", {}, `${f.field}: ${f.matches.join(", ")}`)),
            );
            warning.hidden = false;
            const confirm = warning.querySelector<HTMLButtonElement>("button");
            if (confirm) reveal(confirm);
            return false;
          }
          inspect(
            type,
            result.service.id,
            result.status === "committed"
              ? id === null
                ? "Service added."
                : "Service changes applied."
              : "No changes to apply.",
            id === null ? "overview" : readSection(),
          );
          return true;
        }
        const savedId = d.save(ctx.repo(), id, input, { confirmSensitive });
        inspect(type, savedId, `${d.label} ${id === null ? "added" : "changes applied"}.`);
        ctx.selectionChanged();
        return true;
      } catch (error) {
        if (error instanceof SensitiveInputWarning) {
          pending = input;
          pendingSignature = signature();
          warningList.replaceChildren(
            ...error.findings.map((f) => el("li", {}, `${f.field}: ${f.matches.join(", ")}`)),
          );
          warning.hidden = false;
          const confirm = warning.querySelector<HTMLButtonElement>("button");
          if (confirm) reveal(confirm);
        } else if (error instanceof ValidationError) {
          showError(error.field, error.message, error.targets);
        } else {
          message.textContent = describe(error);
        }
        return false;
      }
    }
    applyCurrent = () => save(collect(), false);

    const detailsPanel = el(
      "section",
      { "data-editor-section": "details", id: "editor-details", role: "tabpanel" },
      ...fields,
    );
    relations = type === "service" || (type === "scenario" && id !== null) ? el("div", { class: "relations" }) : null;
    const body = el(
      "div",
      { class: "editor-body", "data-testid": "editor-scroll" },
      detailsPanel,
      relations,
      warning,
      message,
      diagnosticActions,
      conflictActions,
    );
    const form = el("form", { class: "entity-form", novalidate: "" }, body);
    const tabs = el("nav", { class: "editor-tabs", role: "tablist", "aria-label": "Service editing sections" });
    for (const section of type === "service" ? ["details", "connections", "support"] : ["details"]) {
      const tab = button(
        section,
        () => {
          showSection(section);
        },
        {
          role: "tab",
          id: `editor-tab-${section}`,
          "data-edit-section": section,
          "aria-controls": `editor-${section}`,
        },
      );
      tab.addEventListener("keydown", (event) => {
        const list = [...tabs.querySelectorAll<HTMLButtonElement>("button")];
        const index = list.indexOf(tab);
        const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? list.length - 1
              : (index + offset + list.length) % list.length;
        if (offset || event.key === "Home" || event.key === "End") {
          event.preventDefault();
          list[next]?.click();
          list[next]?.focus();
        }
      });
      tabs.append(tab);
    }
    detailsPanel.setAttribute("aria-labelledby", "editor-tab-details");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      save(collect(), false);
    });
    if (type === "service" && id === null) {
      followNetworkMarking(form);
      followFoundationalName(form);
    }
    // Any edit withdraws a pending "Save anyway": the changed text must be checked again.
    form.addEventListener("input", () => {
      pending = null;
      pendingSignature = null;
      warning.hidden = true;
      draftChanged();
    });

    const actions = el(
      "div",
      { class: "actions" },
      el("button", { type: "submit", class: "primary" }, id === null ? `Add ${noun}` : "Apply changes"),
    );
    if (type === "network" && id !== null) {
      actions.append(
        button(
          "Add service on this network",
          () => {
            ctx.requestServiceOnNetwork?.(id);
          },
          { class: "subtle" },
        ),
      );
    }
    actions.append(
      button(
        "Cancel",
        () => {
          if (ctx.requestCancel) ctx.requestCancel();
          else if (id === null) close();
          else inspect(type, id, "", readSection());
        },
        { class: "subtle" },
      ),
    );
    const more = el("details", { class: "record-actions" }, el("summary", {}, "More edit actions"));
    if (id !== null) more.append(button("Discard changes", discardActiveDraft), deleteControl(type, id, noun, message));
    const footer = el(
      "footer",
      { class: "editor-footer" },
      el("p", { "data-testid": "editor-draft-summary" }),
      actions,
    );
    if (id !== null) footer.append(more);
    form.append(footer);

    element.replaceChildren(
      el(
        "header",
        { class: "editor-heading" },
        el("h2", {}, `${id === null ? "New" : "Edit"} ${noun}`),
        el("p", { class: "editor-identity", "data-testid": "editor-identity" }),
        notice,
        el(
          "p",
          { class: "hint" },
          type === "scenario" && id !== null
            ? "Add change and Remove take effect immediately; use Undo to reverse them. Apply changes saves metadata and any unadded builder choice together. Cancel and Discard handle unapplied metadata and unadded choices; they do not reverse completed Add or Remove commands. Save file also applies a valid draft."
            : `${id === null ? `Use Add ${noun} to create this record.` : "Use Apply changes for all sections."} Save file also applies a valid draft.`,
        ),
      ),
      tabs,
      form,
    );
    if (type === "service" && id === null) {
      const start = button(
        "Start from an existing service",
        () => {
          const owner = current;
          activePicker = openReferencePicker({
            label: "source service",
            returnFocus: start,
            isCurrent: () => owner === current && ctx.repo() === repo,
            options: () =>
              repo.listServices().map((service) => ({
                value: String(service.id),
                label: `${service.name} (${repo.getNetwork(service.networkId)?.name ?? "Unavailable"})`,
                detail: "Create an independent service from these descriptive fields",
              })),
            onSelect: (value) => {
              ctx.requestSimilar?.(Number(value));
            },
          });
        },
        { id: "start-existing", class: "reference-link" },
      );
      detailsPanel.prepend(start);
    }
    if (type === "service") {
      const references: readonly [string, EntityType, string][] = [
        ["networkId", "network", "Network"],
        ["providerOrgId", "organization", "Provided by"],
        ["applicationId", "application", "Application"],
        ["categoryId", "category", "Category"],
      ];
      for (const [key, relatedType, label] of references) {
        const select = form.querySelector<HTMLSelectElement>(`#field-${key}`);
        if (select) referenceControls(select, relatedType, label);
      }
      form.querySelector("#field-networkId")?.addEventListener("change", () => {
        renderRelations();
      });
    } else if (type === "organization") {
      const parent = form.querySelector<HTMLSelectElement>("#field-parentId");
      if (parent) referenceControls(parent, "organization", "Part of");
    }
    renderRelations();
    showSection(activeSection);
    ctx.selectionChanged();
    draftChanged();
    focusSection();
  }

  /** A compact selected-value field opens the common bounded picker. */
  function referenceControls(select: HTMLSelectElement, type: EntityType, label: string): void {
    const d = descriptor(type);
    const owner = current;
    const repo = ctx.repo();
    select.hidden = true;
    select.dataset["reference"] = type;
    const field = (): HTMLSelectElement => element.querySelector<HTMLSelectElement>(`#${select.id}`) ?? select;
    const trigger = button(
      "",
      () => {
        activePicker = openReferencePicker({
          label: d.label.toLowerCase(),
          returnFocus: trigger,
          selectedValue: field().value,
          allowNone: field().options[0]?.value === "",
          isCurrent: () => current === owner && ctx.repo() === repo && element.isConnected,
          options: () => {
            const descriptions = new Map(d.list(repo).map((record) => [String(record.id), record.detail]));
            return [...field().options]
              .filter((item) => item.value !== "" && !item.disabled && d.get(repo, Number(item.value)) !== undefined)
              .map((item) => ({
                value: item.value,
                label: item.text,
                detail: descriptions.get(item.value) ?? "",
              }));
          },
          onSelect: (value) => {
            const invoking = field();
            invoking.value = value;
            invoking.dispatchEvent(new Event("change", { bubbles: true }));
            invoking.dispatchEvent(new Event("input", { bubbles: true }));
            update();
          },
          ...(type === "service" || type === "cds"
            ? {}
            : {
                create: (query: string, complete: (value: string) => void, back: () => void) => {
                  const controls = new Map<string, () => FormValues[string]>();
                  const errors = new Map<string, HTMLElement>();
                  const defaults = { ...d.values(repo, null), name: query };
                  const fields = d.fields.map((f) => renderField(repo, f, defaults, null, errors, controls));
                  const ids = new Map<string, string>();
                  for (const part of fields)
                    for (const node of part.querySelectorAll<HTMLElement>("[id]")) {
                      ids.set(node.id, `child-${node.id}`);
                      node.id = `child-${node.id}`;
                    }
                  for (const part of fields)
                    for (const node of part.querySelectorAll<HTMLElement>(
                      "[for], [aria-describedby], [aria-labelledby]",
                    )) {
                      for (const attribute of ["for", "aria-describedby", "aria-labelledby"]) {
                        const value = node.getAttribute(attribute);
                        if (value)
                          node.setAttribute(
                            attribute,
                            value
                              .split(/\s+/)
                              .map((id) => ids.get(id) ?? id)
                              .join(" "),
                          );
                      }
                    }
                  const message = el("p", { role: "status", "data-testid": "child-message" });
                  const form = el(
                    "form",
                    { novalidate: "", "data-testid": "inline-child" },
                    el("h3", {}, `Create ${nounOf(type)}`),
                    ...fields,
                    el(
                      "p",
                      { class: "hint" },
                      "This shared record remains available if you later cancel the service. Your service is still a draft.",
                    ),
                    message,
                  );
                  const collect = (): FormValues =>
                    Object.fromEntries([...controls].map(([key, read]) => [key, read()]));
                  let confirmed: string | null = null;
                  const commit = (allow: boolean): void => {
                    if (!form.isConnected || current !== owner || ctx.repo() !== repo) return;
                    const values = collect();
                    if (allow && confirmed !== JSON.stringify(values)) {
                      message.textContent = "The pending edit changed. Review and create again.";
                      return;
                    }
                    try {
                      const id = d.save(repo, null, values, { confirmSensitive: allow });
                      const invoking = field();
                      const none = invoking.options[0]?.value === "" ? invoking.options[0].text : null;
                      invoking.replaceChildren(
                        ...(none === null ? [] : [option("", none)]),
                        ...d.list(repo).map((item) => option(String(item.id), item.name)),
                      );
                      const notice = element.querySelector<HTMLElement>(".notice");
                      if (notice) notice.textContent = `${d.label} created. Service changes are still pending.`;
                      complete(String(id));
                      draftChanged();
                    } catch (error) {
                      message.textContent = describe(error);
                      if (error instanceof SensitiveInputWarning) {
                        confirmed = JSON.stringify(values);
                        confirm.hidden = false;
                      }
                    }
                  };
                  const confirm = button("Save anyway", () => {
                    commit(true);
                  });
                  confirm.hidden = true;
                  form.addEventListener("input", () => {
                    confirmed = null;
                    confirm.hidden = true;
                  });
                  form.addEventListener("submit", (event) => {
                    event.preventDefault();
                    commit(false);
                  });
                  form.append(
                    el("button", { type: "submit", class: "primary" }, "Create and use"),
                    confirm,
                    button("Cancel", back),
                  );
                  return form;
                },
              }),
        });
      },
      {
        id: `${select.id}-choose`,
        class: "reference-field",
        "aria-label": `Choose ${label}`,
        "aria-haspopup": "dialog",
        "aria-describedby": select.getAttribute("aria-describedby") ?? "",
      },
    );
    const link = button(
      "",
      () => {
        if (field().value) ctx.requestNavigate?.({ type, id: Number(field().value) }, "peek");
      },
      { class: "reference-link", "aria-label": `Inspect ${label}` },
    );
    const update = (): void => {
      const value = field().selectedOptions[0];
      trigger.textContent = value?.value ? value.text : `Choose ${label.toLowerCase()}`;
      link.textContent = value?.value ? `View ${value.text}` : "";
      link.hidden = !value?.value;
    };
    select.before(trigger);
    select.after(link);
    select.addEventListener("change", update);
    select.addEventListener("reference-refresh", update);
    update();
  }

  /** While a new service is unsaved, picking its network also picks that network's marking. */
  function followNetworkMarking(form: HTMLFormElement): void {
    const network = form.querySelector<HTMLSelectElement>("#field-networkId");
    const marking = form.querySelector<HTMLSelectElement>("#field-marking");
    let markingChosen = false;
    marking?.addEventListener("change", () => {
      markingChosen = true;
    });
    network?.addEventListener("change", () => {
      const nextNetwork = ctx.repo().getNetwork(Number(network.value));
      if (nextNetwork && marking && !markingChosen) marking.value = nextNetwork.marking;
    });
  }

  /** While a new service is unsaved, naming it Identity or DNS ticks Foundational, until the user sets the box. */
  function followFoundationalName(form: HTMLFormElement): void {
    const name = form.querySelector<HTMLInputElement>("#field-name");
    const box = form.querySelector<HTMLInputElement>("#field-foundational");
    if (!name || !box) return;
    let chosen = false;
    box.addEventListener("change", () => {
      chosen = true;
    });
    name.addEventListener("input", () => {
      if (!chosen) box.checked = suggestsFoundational(name.value);
    });
  }

  /** A menu launches a task; its live form belongs on the editor surface. */
  function exposeMenuTask(control: HTMLElement, label: string): (() => void) | undefined {
    const menu = control.closest<HTMLDetailsElement>("details.record-actions, details.connection-actions");
    if (!menu) return undefined;
    const next = control.nextSibling;
    if (menu.classList.contains("record-actions")) element.querySelector(".editor-body")?.append(control);
    else menu.after(control);
    menu.open = false;
    control.classList.add("inline-menu-task");
    control.setAttribute("role", "group");
    control.setAttribute("aria-label", label);
    return () => {
      control.classList.remove("inline-menu-task");
      control.removeAttribute("role");
      control.removeAttribute("aria-label");
      control.removeAttribute("tabindex");
      if (!menu.isConnected) return;
      menu.insertBefore(control, next?.parentNode === menu ? next : null);
      menu.querySelector("summary")?.focus();
    };
  }

  function deleteControl(
    type: EntityType,
    id: number,
    noun: string,
    message: HTMLElement,
    modal?: { afterDelete: () => void; cancel: () => void },
  ): HTMLElement {
    const owner = ctx.repo();
    const box = el("span", { class: "delete" });
    let restoreMenu: (() => void) | undefined;
    const ask = (): void => {
      let plan;
      try {
        plan = ctx.repo().planDelete(type, id);
      } catch (error) {
        message.textContent = describe(error);
        return;
      }
      if (!modal) restoreMenu ??= exposeMenuTask(box, `Delete ${noun}`);
      box.replaceChildren(
        el("p", {}, `Delete ${noun}? This cannot be undone by cancelling, but Undo can restore a completed deletion.`),
        ...(hasPendingDraft()
          ? [el("p", {}, "Your unapplied changes to this record will be discarded if deletion succeeds.")]
          : []),
        el("ul", {}, ...plan.details.map((detail) => el("li", {}, detail))),
        ...(plan.blocked ? [el("p", { class: "field-error", id: "delete-blocked-reason" }, plan.blocked)] : []),
        ...plan.blockers.map((target) =>
          button(target.label, () => {
            ctx.requestNavigate?.({ type: target.type, id: target.id }, "peek");
          }),
        ),
        button(
          "Confirm delete",
          () => {
            try {
              if (ctx.repo() !== owner)
                throw new ValidationError("STALE", "record", "The dataset changed. Review deletion again.");
              owner.deleteWithPlan(type, id, plan.signature);
              close();
              modal?.afterDelete();
              ctx.recordDeleted?.(type, id);
            } catch (error) {
              message.textContent = describe(error);
              if (error instanceof ValidationError && error.code === "STALE") ask();
            }
          },
          { class: "danger", ...(plan.blocked ? { disabled: "", "aria-describedby": "delete-blocked-reason" } : {}) },
        ),
        button("Cancel", modal?.cancel ?? reset),
      );
      if (restoreMenu) {
        box.tabIndex = -1;
        box.focus();
      }
    };
    const reset = (): void => {
      box.replaceChildren(button(`Delete ${noun}`, ask, { class: "subtle" }));
      restoreMenu?.();
      restoreMenu = undefined;
    };
    if (modal) ask();
    else reset();
    return box;
  }

  function renderRelations(): void {
    if (relations && current?.type === "scenario" && current.id !== null) {
      if (!scenarioBuilder) {
        scenarioBuilder = createScenarioChanges(ctx.repo(), current.id, draftChanged, (target) => {
          ctx.requestNavigate?.(target, "peek");
        });
        relations.replaceChildren(...scenarioBuilder.elements);
      } else scenarioBuilder.refresh();
      return;
    }
    if (!relations || current?.type !== "service") return;
    const repo = ctx.repo();
    const serviceId = current.id;
    const orgs = repo.listOrganizations();
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const networks = new Map(repo.listNetworks().map((n) => [n.id, n.name]));
    const services = repo.listServices();
    const serviceName = new Map(services.map((s) => [s.id, s.name]));
    const cdsList = repo.listCds();
    const cdsName = new Map(cdsList.map((c) => [c.id, c.name]));
    const message = el("p", { class: "message", "data-testid": "relation-message", role: "alert" });
    const draft = serviceDraft;
    if (!draft) return;
    const changed = (fallbackId = ""): void => {
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement.id : "";
      renderRelations();
      const restored = focused ? element.querySelector<HTMLElement>(`#${focused}`) : null;
      if (restored && !(restored instanceof HTMLButtonElement && restored.disabled)) restored.focus();
      else if (fallbackId) element.querySelector<HTMLElement>(`#${fallbackId}`)?.focus();
      draftChanged();
    };
    const connectionActions = (label: string): HTMLDetailsElement =>
      el(
        "details",
        { class: "connection-actions" },
        el("summary", { "aria-label": `Connection actions for ${label}` }, "Actions"),
      );
    const pageRows = (
      title: string,
      rows: readonly { label: string; detail: string; element: HTMLElement }[],
    ): HTMLElement => {
      const view = relationViews.get(title) ?? { query: "", page: 0 };
      relationViews.set(title, view);
      if (rows.length === 0) view.query = "";
      const human =
        title === "dependencies"
          ? "outgoing dependencies"
          : title === "consumers"
            ? "consuming organizations"
            : "incoming services";
      const query = el("input", {
        type: "search",
        id: `relation-search-${title}`,
        "aria-label": `Search ${human}`,
        placeholder: `Search ${human}`,
      });
      query.hidden = rows.length === 0;
      query.value = view.query;
      query.addEventListener("keydown", (event) => {
        if (event.key === "Enter") event.preventDefault();
      });
      const list = el("ul", { class: "rows", "data-testid": title });
      const count = el("p", { class: "hint", role: "status" });
      const empty = el("p", { class: "draft-empty" });
      const clear = button("Clear search", () => {
        view.query = "";
        view.page = 0;
        query.value = "";
        render();
        query.focus();
      });
      const previous = button("Previous", () => {
        view.page--;
        render();
        focusPagingControl(previous, next);
      });
      const next = button("Next", () => {
        view.page++;
        render();
        focusPagingControl(next, previous);
      });
      previous.setAttribute("aria-label", `Previous ${title} page`);
      next.setAttribute("aria-label", `Next ${title} page`);
      const paging = el("div", { class: "relationship-paging" }, previous, next);
      function render(): void {
        const result = collectionPage(rows, view.query, view.page);
        view.page = result.page;
        list.replaceChildren(...result.rows.map((row) => row.element));
        count.textContent = `${String(result.first)}-${String(result.last)} of ${String(result.total)} relationships`;
        count.hidden = result.total === 0;
        empty.textContent = rows.length === 0 ? "None recorded." : "No matching relationships.";
        empty.hidden = result.total > 0;
        clear.hidden = rows.length === 0 || result.total > 0;
        paging.hidden = result.pages <= 1;
        previous.disabled = view.page === 0;
        next.disabled = view.page + 1 >= result.pages;
      }
      query.addEventListener("input", () => {
        view.query = query.value;
        view.page = 0;
        render();
      });
      render();
      return el("div", { class: "draft-collection" }, query, count, list, empty, clear, paging);
    };

    // Support: one organization per tier; each change is its own write.
    const support = draft.support;
    const tiers = TIERS.map((tier) => {
      const existing = support.find((s) => s.tier === tier);
      const id = `support-${String(tier)}`;
      const select = el("select", { id }, option("", "(none)"));
      for (const o of orgs) select.append(option(String(o.id), o.name, existing?.orgId === o.id));
      const notesId = `support-notes-${String(tier)}`;
      const notes = el("input", { id: notesId, type: "text", autocomplete: "off" });
      notes.value = existing?.notes ?? "";
      notes.disabled = existing === undefined;
      select.addEventListener("change", () => {
        const index = draft.support.findIndex((row) => row.tier === tier);
        if (index >= 0) draft.support.splice(index, 1);
        if (select.value !== "") {
          draft.support.push({ tier, orgId: Number(select.value), notes: existing?.notes ?? null });
          draft.support.sort((a, b) => a.tier - b.tier);
        }
        changed();
      });
      notes.addEventListener("input", () => {
        const row = draft.support.find((item) => item.tier === tier);
        if (row) row.notes = notes.value === "" ? null : notes.value;
        draftChanged();
      });
      return el(
        "div",
        { class: "field" },
        el("label", { for: id }, `Tier ${String(tier)} support`),
        select,
        el("label", { for: notesId }, `Tier ${String(tier)} support notes`),
        notes,
      );
    });

    // Consumers: organizations that use this service.
    const consumerIds = draft.consumerOrgIds;
    const consumerRows = consumerIds.map((orgId) => {
      const name = orgName.get(orgId) ?? "?";
      const row = el(
        "li",
        {},
        el("span", { class: "row-name" }, name),
        button(
          "Remove",
          () => {
            draft.consumerOrgIds = draft.consumerOrgIds.filter((id) => id !== orgId);
            changed("add-consumer");
          },
          { "aria-label": `Remove consumer ${name}`, class: "subtle", id: `remove-consumer-${String(orgId)}` },
        ),
      );
      return { label: name, detail: "", element: row };
    });
    const consumerPick = el("select", { id: "add-consumer" }, option("", "Choose a consuming organization"));
    for (const o of orgs) if (!consumerIds.includes(o.id)) consumerPick.append(option(String(o.id), o.name));
    if (relationIntent.consumer) consumerPick.value = relationIntent.consumer;
    consumerPick.addEventListener("change", () => {
      relationIntent.consumer = consumerPick.value;
      relationIntent.touched = Boolean(relationIntent.consumer || relationIntent.provider || relationIntent.via);
      addConsumer.disabled = consumerPick.value === "";
      draftChanged();
    });
    const addConsumer = button("Add consumer", () => {
      if (consumerPick.value === "") return;
      draft.consumerOrgIds.push(Number(consumerPick.value));
      draft.consumerOrgIds.sort((a, b) => a - b);
      relationIntent.consumer = "";
      relationIntent.touched = false;
      changed("add-consumer");
    });
    addConsumer.id = "add-consumer-action";
    addConsumer.disabled = consumerPick.value === "";

    // Dependencies: services this service relies on, optionally through a CDS.
    const deps = draft.dependencies;
    const depRows = deps.map((dep) => {
      const name = serviceName.get(dep.providerServiceId) ?? "?";
      const provider = services.find((item) => item.id === dep.providerServiceId);
      const via = dep.viaCdsId === null ? "; No CDS recorded" : ` via ${cdsName.get(dep.viaCdsId) ?? "?"}`;
      const networkName = networks.get(provider?.networkId ?? 0) ?? "?";
      const label = `${name} (${networkName})`;
      const actions = connectionActions(label);
      const route = el("span", {
        class: "route-edit inline-menu-task",
        role: "group",
        "aria-label": `Edit route for ${name}`,
      });
      route.hidden = true;
      const editRoute = button(
        "Edit route",
        () => {
          actions.open = false;
          route.hidden = false;
          const pick = el(
            "select",
            { "aria-label": `Route for ${name}` },
            option("", "No CDS recorded", dep.viaCdsId === null),
          );
          const networkId = Number(element.querySelector<HTMLSelectElement>("#field-networkId")?.value);
          for (const cds of cdsList) {
            const valid =
              provider &&
              provider.networkId !== networkId &&
              cds.networkIds.includes(networkId) &&
              cds.networkIds.includes(provider.networkId);
            if (cds.id === dep.viaCdsId || valid) {
              const item = option(
                String(cds.id),
                cds.name + (valid ? "" : " (current route; not valid for these endpoints)"),
                cds.id === dep.viaCdsId,
              );
              item.disabled = !valid;
              pick.append(item);
            }
          }
          route.replaceChildren(
            pick,
            button("Use route", () => {
              dep.viaCdsId = pick.value === "" ? null : Number(pick.value);
              changed("add-dependency");
            }),
            button("Cancel route", () => {
              route.replaceChildren();
              route.hidden = true;
              actions.querySelector("summary")?.focus();
            }),
          );
          pick.focus();
        },
        { "aria-label": `Edit route to ${name}` },
      );
      const nameCell = el(
        "div",
        { class: "row-name" },
        button(
          label,
          () => {
            ctx.requestNavigate?.({ type: "service", id: dep.providerServiceId }, "peek");
          },
          { class: "reference-link" },
        ),
        el("small", {}, via.replace(/^; /, "")),
      );
      if (serviceId !== null)
        actions.append(
          button(`Inspect connection to ${label}`, () => {
            ctx.requestDependency?.(serviceId, dep.providerServiceId);
          }),
        );
      actions.append(
        editRoute,
        button(
          "Remove",
          () => {
            draft.dependencies = draft.dependencies.filter((row) => row.providerServiceId !== dep.providerServiceId);
            changed("add-dependency");
          },
          {
            "aria-label": `Remove dependency on ${name}`,
            class: "subtle",
            id: `remove-dependency-${String(dep.providerServiceId)}`,
          },
        ),
      );
      return { label: name, detail: `${networkName} ${via}`, element: el("li", {}, nameCell, actions, route) };
    });
    const taken = new Set(deps.map((dep) => dep.providerServiceId));
    const providerPick = el("select", { id: "add-dependency" }, option("", "Choose a service"));
    for (const s of services) {
      if (s.id === serviceId || taken.has(s.id)) continue;
      providerPick.append(option(String(s.id), `${s.name} (${networks.get(s.networkId) ?? "?"})`));
    }
    if (relationIntent.provider) providerPick.value = relationIntent.provider;
    const viaPick = el("select", { id: "add-dependency-via" }, option("", "No CDS recorded"));
    const updateRoutes = (): void => {
      const next = services.find((service) => service.id === Number(providerPick.value));
      const networkId = Number(element.querySelector<HTMLSelectElement>("#field-networkId")?.value);
      viaPick.replaceChildren(option("", "No CDS recorded"));
      for (const c of cdsList) {
        const valid =
          next &&
          next.networkId !== networkId &&
          c.networkIds.includes(networkId) &&
          c.networkIds.includes(next.networkId);
        if (valid || String(c.id) === relationIntent.via) {
          const choice = option(String(c.id), c.name + (valid ? "" : " (not valid for these endpoints)"));
          choice.disabled = !valid;
          viaPick.append(choice);
        }
      }
      viaPick.value = relationIntent.via;
    };
    updateRoutes();
    providerPick.addEventListener("change", () => {
      relationIntent.provider = providerPick.value;
      relationIntent.touched = Boolean(relationIntent.consumer || relationIntent.provider || relationIntent.via);
      addDependency.disabled = providerPick.value === "";
      updateRoutes();
      draftChanged();
    });
    viaPick.addEventListener("change", () => {
      relationIntent.via = viaPick.value;
      relationIntent.touched = true;
      draftChanged();
    });
    const addDependency = button("Add dependency", () => {
      if (providerPick.value === "") return;
      draft.dependencies.push({
        providerServiceId: Number(providerPick.value),
        viaCdsId: viaPick.value === "" ? null : Number(viaPick.value),
      });
      draft.dependencies.sort((a, b) => a.providerServiceId - b.providerServiceId);
      relationIntent.provider = "";
      relationIntent.via = "";
      relationIntent.touched = false;
      changed("add-dependency");
    });
    addDependency.id = "add-dependency-action";
    addDependency.disabled = providerPick.value === "";

    const supportPanel = el(
      "section",
      {
        "data-editor-section": "support",
        id: "editor-support",
        role: "tabpanel",
        "aria-labelledby": "editor-tab-support",
      },
      el("h3", {}, "Support (optional)"),
      ...tiers,
    );
    const connectionsPanel = el(
      "section",
      {
        "data-editor-section": "connections",
        id: "editor-connections",
        role: "tabpanel",
        "aria-labelledby": "editor-tab-connections",
      },
      el("h3", {}, "Consumed by organizations"),
      pageRows("consumers", consumerRows),
      el(
        "div",
        { class: "add-row" },
        el("label", { for: "add-consumer" }, "Consuming organization"),
        consumerPick,
        addConsumer,
      ),
      el("h3", {}, "Depends on"),
      pageRows("dependencies", depRows),
      el(
        "div",
        { class: "add-row" },
        el("label", { for: "add-dependency" }, "Depends on service"),
        providerPick,
        el("label", { for: "add-dependency-via" }, "Via CDS"),
        viaPick,
        addDependency,
      ),
      message,
    );
    relations.replaceChildren(supportPanel, connectionsPanel);
    for (const tier of TIERS) {
      const select = relations.querySelector<HTMLSelectElement>(`#support-${String(tier)}`);
      if (select) referenceControls(select, "organization", `Tier ${String(tier)} support`);
    }
    referenceControls(consumerPick, "organization", "Consuming organization");
    referenceControls(providerPick, "service", "Depends on service");
    const incoming = repo.listDependencies().filter((dep) => dep.providerServiceId === serviceId);
    connectionsPanel.append(
      el("h3", {}, "Used by services"),
      pageRows(
        "incoming-dependencies",
        incoming.map((dep) => {
          const consumer = services.find((s) => s.id === dep.consumerServiceId);
          const label = `${consumer?.name ?? "Unavailable"} (${networks.get(consumer?.networkId ?? 0) ?? "?"})`;
          const nameCell = button(
            label,
            () => {
              ctx.requestNavigate?.({ type: "service", id: dep.consumerServiceId }, "peek");
            },
            { class: "reference-link" },
          );
          const actions = connectionActions(label);
          actions.append(
            button("Edit incoming dependency", () => {
              ctx.requestNavigate?.({ type: "service", id: dep.consumerServiceId }, "edit");
            }),
          );
          if (serviceId !== null)
            actions.append(
              button(`Inspect incoming connection from ${label}`, () => {
                ctx.requestDependency?.(dep.consumerServiceId, serviceId);
              }),
            );
          return { label, detail: "", element: el("li", {}, nameCell, actions) };
        }),
      ),
    );
    showSection(activeSection);
  }

  function refresh(): void {
    if (!current) return;
    if (!editing) {
      const notice = element.querySelector<HTMLElement>(".notice")?.textContent ?? "";
      const summary = element.querySelector<HTMLElement>(".record-summary");
      const view = summary ? captureRecordSummaryView(summary) : undefined;
      const scrollTop = element.scrollTop;
      const restoreFocus = summary?.contains(document.activeElement) ?? false;
      if (current.id !== null && descriptor(current.type).get(ctx.repo(), current.id) !== undefined) {
        inspect(current.type, current.id, notice, view?.section, false, view);
        element.scrollTop = scrollTop;
        const next = element.querySelector<HTMLElement>(".record-summary");
        if (next && view) restoreRecordSummaryView(next, view, { focus: restoreFocus });
      } else close();
      return;
    }
    // The item was removed elsewhere (or the dataset replaced): nothing left to edit.
    if (current.id !== null && descriptor(current.type).get(ctx.repo(), current.id) === undefined) {
      if (hasPendingDraft()) reportExternalChange?.("deleted");
      else close();
      return;
    }
    if (current.type === "service" && current.id !== null && serviceBase && hasPendingDraft()) {
      const latest = ctx.repo().readServiceEditBase(current.id);
      if (JSON.stringify(latest) !== JSON.stringify(serviceBase)) {
        reportExternalChange?.("changed");
        return;
      }
    }
    if (current.type === "scenario") scenarioBuilder?.refresh();
    else if (!hasPendingDraft()) renderRelations();
    updateEditingIdentity();
  }

  function reload(): void {
    if (!current || current.id === null) return;
    if (descriptor(current.type).get(ctx.repo(), current.id) === undefined) {
      if (hasPendingDraft()) reportExternalChange?.("deleted");
      else close();
    } else if (editing) open(current.type, current.id);
    else refresh();
  }

  placeholder();
  return {
    element,
    selection: () => current,
    inspect: (type, id, section) => {
      inspect(type, id, "", section);
    },
    createSimilar,
    isEditing: () => editing,
    viewContext: () => ({
      editing,
      section: editing
        ? activeSection
        : (element.querySelector<HTMLElement>(".record-summary")?.dataset["summarySection"] ?? "overview"),
      scrollTop: element.scrollTop,
      summary: captureRecordSummaryView(element.querySelector<HTMLElement>(".record-summary") ?? element),
    }),
    restoreViewContext: (view) => {
      if (editing) showSection(view.section);
      else if (current?.id !== null && current)
        inspect(
          current.type,
          current.id,
          "",
          view.section === "details" ? "overview" : (view.section as SummarySection),
          false,
          view.summary,
        );
      element.scrollTop = view.scrollTop;
      const summary = element.querySelector<HTMLElement>(".record-summary");
      if (summary && view.summary) restoreRecordSummaryView(summary, view.summary, { focus: true });
    },
    open: (type, id, section) => {
      open(type, id, "", section);
    },
    close,
    refresh,
    reload,
    hasPendingDraft,
    pendingDraftLabel,
    applyActiveDraft,
    discardActiveDraft,
    inspectProjected,
    openServiceOnNetwork,
  };
}

function renderField(
  repo: Repository,
  f: FieldDef,
  values: FormValues,
  editingId: number | null,
  errors: Map<string, HTMLElement>,
  controls: Map<string, () => FormValues[string]>,
): HTMLElement {
  const id = `field-${f.key}`;
  const error = el("p", { class: "field-error", "data-testid": `error-${f.key}`, id: `${id}-error` });
  error.hidden = true;
  errors.set(f.key, error);
  const value = values[f.key];
  const text = typeof value === "string" ? value : "";
  const label = el("label", { for: id }, f.label);
  const described = { id, "aria-describedby": `${id}-error` };

  switch (f.kind) {
    case "text": {
      const input = el("input", { ...described, type: "text", autocomplete: "off" });
      input.value = text;
      if (f.required) input.required = true;
      controls.set(f.key, () => input.value);
      return el("div", { class: "field" }, label, input, error);
    }
    case "textarea": {
      const input = el("textarea", { ...described, rows: "3" });
      input.value = text;
      controls.set(f.key, () => input.value);
      return el("div", { class: "field" }, label, input, error);
    }
    case "color": {
      const input = el("input", { ...described, type: "text", placeholder: "#1a2b3c", autocomplete: "off" });
      input.value = text;
      const picker = el("input", { type: "color", "aria-label": `${f.label} picker`, tabindex: "-1" });
      picker.value = /^#[0-9a-f]{6}$/i.test(text) ? text : "#888888";
      picker.addEventListener("input", () => {
        input.value = picker.value;
      });
      input.addEventListener("input", () => {
        if (/^#[0-9a-f]{6}$/i.test(input.value)) picker.value = input.value;
      });
      controls.set(f.key, () => input.value);
      return el("div", { class: "field" }, label, el("div", { class: "color-row" }, input, picker), error);
    }
    case "select": {
      const select = el("select", described);
      if (f.none !== undefined) select.append(option("", f.none, text === ""));
      for (const o of f.options?.(repo, editingId) ?? []) select.append(option(o.value, o.label, o.value === text));
      controls.set(f.key, () => select.value);
      return el("div", { class: "field" }, label, select, error);
    }
    case "checkbox": {
      const input = el("input", { ...described, type: "checkbox" });
      input.checked = value === true;
      controls.set(f.key, () => input.checked);
      return el("div", { class: "field check" }, input, label, error);
    }
    case "checklist": {
      const chosen = new Set(Array.isArray(value) ? value : []);
      const options = f.options?.(repo, editingId) ?? [];
      let page = 0;
      const search = el("input", { type: "search", "aria-label": `Search ${f.label.toLowerCase()}` });
      search.addEventListener("keydown", (event) => {
        if (event.key === "Enter") event.preventDefault();
      });
      const list = el("div");
      const count = el("p", { class: "hint", role: "status" });
      const previous = button("Previous choices", () => {
        page--;
        render();
        focusPagingControl(previous, next);
      });
      const next = button("Next choices", () => {
        page++;
        render();
        focusPagingControl(next, previous);
      });
      const root = el(
        "fieldset",
        { class: "field", "aria-describedby": `${id}-error` },
        el("legend", {}, f.label),
        search,
        count,
        list,
        el("div", { class: "actions" }, previous, next),
        error,
      );
      function render(): void {
        const matches = options.filter((item) => item.label.toLowerCase().includes(search.value.trim().toLowerCase()));
        page = Math.max(0, Math.min(page, Math.ceil(matches.length / 20) - 1));
        list.replaceChildren(
          ...matches.slice(page * 20, page * 20 + 20).map((o) => {
            const box = el("input", { type: "checkbox", id: `${id}-${o.value}`, value: o.value });
            box.checked = chosen.has(o.value);
            box.addEventListener("change", () => {
              if (box.checked) chosen.add(o.value);
              else chosen.delete(o.value);
              box.dispatchEvent(new Event("input", { bubbles: true }));
            });
            return el("div", { class: "check" }, box, el("label", { for: box.id }, o.label));
          }),
        );
        count.textContent = `${String(matches.length)} matching choices; ${String(chosen.size)} selected`;
        previous.disabled = page === 0;
        next.disabled = (page + 1) * 20 >= matches.length;
      }
      search.addEventListener("input", (event) => {
        event.stopPropagation();
        page = 0;
        render();
      });
      controls.set(f.key, () => [...chosen]);
      render();
      return root;
    }
  }
}
