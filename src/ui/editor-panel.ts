import { SensitiveInputWarning, ValidationError } from "../domain/errors";
import type { Repository, ServiceEditBase } from "../domain/repository";
import type { Tier } from "../domain/types";
import type { Snapshot } from "../domain/types";
import type { GraphNode, MapEntity } from "../map/graph";
import { dependencyKey, type Comparison, type ProjectedSnapshot } from "../scenario/scenario";
import { button, el, option } from "./dom";
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

export interface EditorContext {
  repo(): Repository;
  /** The editor opened, saved or closed an item; the list should update its highlight. */
  selectionChanged(): void;
  draftChanged?(): void;
  requestServiceOnNetwork?(networkId: number): void;
}

export interface EditorPanel {
  readonly element: HTMLElement;
  selection(): Selection | null;
  open(type: EntityType, id: number | null): void;
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
  let serviceDraft: {
    support: { tier: Tier; orgId: number; notes: string | null }[];
    consumerOrgIds: number[];
    dependencies: { providerServiceId: number; viaCdsId: number | null }[];
  } | null = null;

  function hasPendingDraft(): boolean {
    if (scenarioBuilder?.hasPendingIntent()) return true;
    if (!collectCurrent || !baseValues) return false;
    if (JSON.stringify(collectCurrent()) !== JSON.stringify(baseValues)) return true;
    if (serviceBase && serviceDraft) {
      return (
        JSON.stringify(serviceDraft) !==
        JSON.stringify({
          support: serviceBase.support.map((s) => ({ tier: s.tier, orgId: s.orgId, notes: s.notes })),
          consumerOrgIds: [...serviceBase.consumerOrgIds],
          dependencies: serviceBase.dependencies.map((d) => ({
            providerServiceId: d.providerServiceId,
            viaCdsId: d.viaCdsId,
          })),
        })
      );
    }
    return false;
  }

  function pendingDraftLabel(): string {
    return scenarioBuilder?.hasPendingIntent() ? "Unadded scenario change" : "Unapplied changes";
  }

  function draftChanged(): void {
    ctx.draftChanged?.();
  }

  function discardActiveDraft(): void {
    if (!current) return;
    if (current.id !== null && descriptor(current.type).get(ctx.repo(), current.id) === undefined) close();
    else open(current.type, current.id);
  }

  function inspectProjected(
    node: GraphNode,
    view: { kind: "to-be" | "compare"; scenarioId: number },
    projected: Snapshot,
    comparison: Comparison | null,
    actions: { editAsIs(entity: MapEntity, id: number): void; openScenario(id: number): void },
  ): void {
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
        const consumers = projected.consumption.filter((item) => item.serviceId === service.id);
        details.push(
          el("p", {}, `${String(providers.length)} dependencies; ${String(consumers.length)} consumer organizations.`),
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
        "Create first network",
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

  function open(type: EntityType, id: number | null, noticeText = ""): void {
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
      : null;

    const errors = new Map<string, HTMLElement>();
    const controls = new Map<string, () => FormValues[string]>();
    const fields = d.fields.map((f) => renderField(repo, f, values, id, errors, controls));

    const message = el("p", { class: "message", "data-testid": "editor-message", role: "alert" });
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
      JSON.stringify([type, id, collect(), scenarioBuilder?.collectPendingIntent() ?? null]);
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
      for (const e of errors.values()) {
        e.textContent = "";
        e.hidden = true;
      }
      message.textContent = "";
      conflictActions.hidden = true;
      notice.textContent = "";
    };
    const showError = (field: string, text: string): void => {
      const key = fieldFor(type, field);
      const target = key === null ? undefined : errors.get(key);
      if (target) {
        target.textContent = text;
        target.hidden = false;
      } else {
        message.textContent = text;
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
          open(type, id, "Scenario changes applied.");
          return true;
        }
        if (type === "service" && id !== null && serviceBase && serviceDraft) {
          const result = ctx.repo().applyServiceDraft(
            id,
            serviceBase,
            {
              fields: serviceInputFromValues(input),
              support: serviceDraft.support,
              consumerOrgIds: serviceDraft.consumerOrgIds,
              dependencies: serviceDraft.dependencies,
            },
            { confirmSensitive },
          );
          if (result.status === "conflict") {
            showExternalChange("changed");
            return false;
          }
          if (result.status === "refused") {
            showError(result.error.field, result.error.message);
            return false;
          }
          if (result.status === "needs-confirmation") {
            pending = input;
            pendingSignature = signature();
            warningList.replaceChildren(
              ...result.warning.findings.map((f) => el("li", {}, `${f.field}: ${f.matches.join(", ")}`)),
            );
            warning.hidden = false;
            return false;
          }
          open(type, id, result.status === "committed" ? "Service changes applied." : "No changes to apply.");
          return true;
        }
        const savedId = d.save(ctx.repo(), id, input, { confirmSensitive });
        open(type, savedId, `${d.label} ${id === null ? "added" : "changes applied"}.`);
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
        } else if (error instanceof ValidationError) {
          showError(error.field, error.message);
        } else {
          message.textContent = describe(error);
        }
        return false;
      }
    }
    applyCurrent = () => save(collect(), false);

    const form = el(
      "form",
      { class: "entity-form", novalidate: "" },
      ...fields,
      warning,
      message,
      conflictActions,
      notice,
    );
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
    if (id !== null) actions.append(button("Discard changes", discardActiveDraft, { class: "subtle" }));
    if (id !== null) actions.append(deleteControl(type, id, noun, message));
    form.append(actions);

    relations = (type === "service" || type === "scenario") && id !== null ? el("div", { class: "relations" }) : null;
    element.replaceChildren(el("h2", {}, `${id === null ? "New" : "Edit"} ${noun}`), form, relations ?? "");
    renderRelations();
    ctx.selectionChanged();
    draftChanged();
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

  function deleteControl(type: EntityType, id: number, noun: string, message: HTMLElement): HTMLElement {
    const box = el("span", { class: "delete" });
    const ask = (): void => {
      let plan;
      try {
        plan = ctx.repo().planDelete(type, id);
      } catch (error) {
        message.textContent = describe(error);
        return;
      }
      box.replaceChildren(
        el("p", {}, `Delete ${noun}? This cannot be undone by cancelling, but Undo can restore a completed deletion.`),
        ...(hasPendingDraft()
          ? [el("p", {}, "Your unapplied changes to this record will be discarded if deletion succeeds.")]
          : []),
        el("ul", {}, ...plan.details.map((detail) => el("li", {}, detail))),
        ...(plan.blocked ? [el("p", { class: "field-error" }, plan.blocked)] : []),
        button(
          "Confirm delete",
          () => {
            try {
              ctx.repo().deleteWithPlan(type, id, plan.signature);
              close();
            } catch (error) {
              message.textContent = describe(error);
              if (error instanceof ValidationError && error.code === "STALE") ask();
            }
          },
          { class: "danger" },
        ),
        button("Cancel", reset),
      );
    };
    const reset = (): void => {
      box.replaceChildren(button(`Delete ${noun}`, ask, { class: "subtle" }));
    };
    reset();
    return box;
  }

  function renderRelations(): void {
    if (relations && current?.type === "scenario" && current.id !== null) {
      if (!scenarioBuilder) {
        scenarioBuilder = createScenarioChanges(ctx.repo(), current.id, draftChanged);
        relations.replaceChildren(...scenarioBuilder.elements);
      } else scenarioBuilder.refresh();
      return;
    }
    if (!relations || current?.type !== "service" || current.id === null) return;
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
    const changed = (): void => {
      renderRelations();
      draftChanged();
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
      return el(
        "li",
        {},
        el("span", { class: "row-name" }, name),
        button(
          "Remove",
          () => {
            draft.consumerOrgIds = draft.consumerOrgIds.filter((id) => id !== orgId);
            changed();
          },
          { "aria-label": `Remove consumer ${name}`, class: "subtle" },
        ),
      );
    });
    const consumerPick = el("select", { id: "add-consumer" });
    for (const o of orgs) if (!consumerIds.includes(o.id)) consumerPick.append(option(String(o.id), o.name));
    const addConsumer = button("Add consumer", () => {
      if (consumerPick.value === "") return;
      draft.consumerOrgIds.push(Number(consumerPick.value));
      draft.consumerOrgIds.sort((a, b) => a - b);
      changed();
    });
    addConsumer.disabled = consumerPick.options.length === 0;

    // Dependencies: services this service relies on, optionally through a CDS.
    const deps = draft.dependencies;
    const depRows = deps.map((dep) => {
      const name = serviceName.get(dep.providerServiceId) ?? "?";
      const via = dep.viaCdsId === null ? "" : ` via ${cdsName.get(dep.viaCdsId) ?? "?"}`;
      return el(
        "li",
        {},
        el("span", { class: "row-name" }, name + via),
        button(
          "Remove",
          () => {
            draft.dependencies = draft.dependencies.filter((row) => row.providerServiceId !== dep.providerServiceId);
            changed();
          },
          { "aria-label": `Remove dependency on ${name}`, class: "subtle" },
        ),
      );
    });
    const taken = new Set(deps.map((dep) => dep.providerServiceId));
    const providerPick = el("select", { id: "add-dependency" });
    for (const s of services) {
      if (s.id === serviceId || taken.has(s.id)) continue;
      providerPick.append(option(String(s.id), `${s.name} (${networks.get(s.networkId) ?? "?"})`));
    }
    const viaPick = el("select", { id: "add-dependency-via" }, option("", "(direct)"));
    for (const c of cdsList) viaPick.append(option(String(c.id), c.name));
    const addDependency = button("Add dependency", () => {
      if (providerPick.value === "") return;
      draft.dependencies.push({
        providerServiceId: Number(providerPick.value),
        viaCdsId: viaPick.value === "" ? null : Number(viaPick.value),
      });
      draft.dependencies.sort((a, b) => a.providerServiceId - b.providerServiceId);
      changed();
    });
    addDependency.disabled = providerPick.options.length === 0;

    relations.replaceChildren(
      el("h3", {}, "Support"),
      ...tiers,
      el("h3", {}, "Consumed by"),
      el("ul", { class: "rows", "data-testid": "consumers" }, ...consumerRows),
      el("div", { class: "add-row" }, el("label", { for: "add-consumer" }, "Add consumer"), consumerPick, addConsumer),
      el("h3", {}, "Depends on"),
      el("ul", { class: "rows", "data-testid": "dependencies" }, ...depRows),
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
  }

  function refresh(): void {
    if (!current) return;
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
  }

  function reload(): void {
    if (!current || current.id === null) return;
    if (descriptor(current.type).get(ctx.repo(), current.id) === undefined) {
      if (hasPendingDraft()) reportExternalChange?.("deleted");
      else close();
    } else open(current.type, current.id);
  }

  placeholder();
  return {
    element,
    selection: () => current,
    open: (type, id) => {
      open(type, id);
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
      const chosen = Array.isArray(value) ? value : [];
      const boxes = (f.options?.(repo, editingId) ?? []).map((o) => {
        const box = el("input", { type: "checkbox", id: `${id}-${o.value}`, value: o.value });
        box.checked = chosen.includes(o.value);
        return { box, row: el("div", { class: "check" }, box, el("label", { for: `${id}-${o.value}` }, o.label)) };
      });
      controls.set(f.key, () => boxes.filter((b) => b.box.checked).map((b) => b.box.value));
      return el(
        "fieldset",
        { class: "field", "aria-describedby": `${id}-error` },
        el("legend", {}, f.label),
        ...boxes.map((b) => b.row),
        error,
      );
    }
  }
}
