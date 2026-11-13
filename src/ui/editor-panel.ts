import { SensitiveInputWarning, ValidationError, type DiagnosticTarget } from "../domain/errors";
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
import { relatedEntities } from "./relations";

export interface EditorContext {
  repo(): Repository;
  /** The editor opened, saved or closed an item; the list should update its highlight. */
  selectionChanged(): void;
  draftChanged?(): void;
  requestServiceOnNetwork?(networkId: number): void;
  requestNavigate?(target: { type: EntityType; id: number }, intent: "peek" | "edit"): void;
  requestDependency?(consumer: number, provider: number): void;
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
  let recordedRelations: HTMLElement | null = null;
  let collectCurrent: (() => FormValues) | null = null;
  let baseValues: FormValues | null = null;
  let applyCurrent: (() => boolean) | null = null;
  let reportExternalChange: ((reason: "changed" | "deleted") => void) | null = null;
  let serviceBase: ServiceEditBase | null = null;
  let scenarioBuilder: ScenarioChangeBuilder | null = null;
  let activeChild: HTMLDialogElement | null = null;
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
    relationIntent = { consumer: "", provider: "", via: "", touched: false };
    activeChild?.close();
    activeChild?.remove();
    activeChild = null;
    current = null;
    relations = null;
    recordedRelations = null;
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

    const message = el("p", { class: "message", "data-testid": "editor-message", role: "alert" });
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
      for (const e of errors.values()) {
        e.textContent = "";
        e.hidden = true;
      }
      message.textContent = "";
      diagnosticActions.replaceChildren();
      conflictActions.hidden = true;
      notice.textContent = "";
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
            return false;
          }
          open(
            type,
            result.service.id,
            result.status === "committed"
              ? id === null
                ? "Service added."
                : "Service changes applied."
              : "No changes to apply.",
          );
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
          showError(error.field, error.message, error.targets);
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
      diagnosticActions,
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
    else actions.append(button("Cancel", close, { class: "subtle" }));
    if (id !== null) actions.append(deleteControl(type, id, noun, message));
    form.append(actions);

    relations = type === "service" || (type === "scenario" && id !== null) ? el("div", { class: "relations" }) : null;
    recordedRelations =
      id === null
        ? null
        : el("section", { "aria-label": "Recorded relationships", "data-testid": "recorded-relationships" });
    element.replaceChildren(
      el("h2", {}, `${id === null ? "New" : "Edit"} ${noun}`),
      form,
      relations ?? "",
      recordedRelations ?? "",
    );
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
    }
    renderRelations();
    ctx.selectionChanged();
    draftChanged();
  }

  /** One bounded child form; the parent DOM, draft and explicit overrides stay mounted. */
  function referenceControls(select: HTMLSelectElement, type: EntityType, label: string): void {
    const d = descriptor(type);
    const noun = nounOf(type);
    const search = el("input", {
      type: "search",
      "aria-label": `Find ${noun} choices`,
      placeholder: `Search ${label}`,
    });
    search.addEventListener("input", () => {
      const needle = search.value.trim().toLowerCase();
      for (const item of select.options)
        item.hidden = item.value !== select.value && !item.text.toLowerCase().includes(needle);
    });
    const create = button(
      type === "network"
        ? "Create network"
        : label === "Add consumer"
          ? "Create consuming organization"
          : `Create ${noun} for ${label}`,
      () => {
        if (activeChild) return;
        const owner = current;
        const repo = ctx.repo();
        const dialog = el("dialog", { "aria-label": `Create ${noun}`, "data-testid": "inline-child" });
        activeChild = dialog;
        const controls = new Map<string, () => FormValues[string]>();
        const errors = new Map<string, HTMLElement>();
        const message = el("p", { role: "status", "data-testid": "child-message" });
        const fields = d.fields.map((f) => renderField(repo, f, d.values(repo, null), null, errors, controls));
        // Child field IDs are local to the modal and must not collide with the mounted parent.
        const childIds = new Map<string, string>();
        for (const field of fields) {
          for (const node of field.querySelectorAll<HTMLElement>("[id]")) {
            childIds.set(node.id, `child-${node.id}`);
            node.id = `child-${node.id}`;
          }
        }
        for (const field of fields) {
          for (const node of field.querySelectorAll<HTMLElement>("[for], [aria-describedby], [aria-labelledby]")) {
            for (const attribute of ["for", "aria-describedby", "aria-labelledby"]) {
              const value = node.getAttribute(attribute);
              if (value)
                node.setAttribute(
                  attribute,
                  value
                    .split(/\s+/)
                    .map((id) => childIds.get(id) ?? id)
                    .join(" "),
                );
            }
          }
        }
        const form = el("form", { novalidate: "" }, el("h2", {}, `Create ${noun}`), ...fields, message);
        let confirmed: string | null = null;
        const collect = (): FormValues => Object.fromEntries([...controls].map(([key, read]) => [key, read()]));
        const finish = (): void => {
          dialog.close();
          dialog.remove();
          activeChild = null;
          const invoking = element.querySelector<HTMLSelectElement>(`#${select.id}`);
          (invoking ?? select).focus();
        };
        const commit = (allow: boolean): void => {
          const values = collect();
          if (current !== owner || ctx.repo() !== repo) {
            finish();
            return;
          }
          if (allow && confirmed !== JSON.stringify(values)) {
            message.textContent = "The pending edit changed. Review and create again.";
            return;
          }
          try {
            const id = d.save(repo, null, values, { confirmSensitive: allow });
            // Reconcile choices in place, including reference controls outside the scalar form.
            const invoking = element.querySelector<HTMLSelectElement>(`#${select.id}`) ?? select;
            const none = invoking.options[0]?.value === "" ? invoking.options[0].text : null;
            invoking.replaceChildren(
              ...(none === null ? [] : [option("", none)]),
              ...d.list(repo).map((item) => option(String(item.id), item.name, item.id === id)),
            );
            invoking.value = String(id);
            invoking.dispatchEvent(new Event("change", { bubbles: true }));
            invoking.dispatchEvent(new Event("input", { bubbles: true }));
            const notice = element.querySelector<HTMLElement>(".notice");
            if (notice) notice.textContent = `${d.label} created and selected. Service changes have not been applied.`;
            finish();
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
          button("Cancel", finish),
        );
        dialog.addEventListener("cancel", (event) => {
          event.preventDefault();
          finish();
        });
        dialog.append(form);
        document.body.append(dialog);
        dialog.showModal();
      },
    );
    const inspect = button(
      label === "Add consumer" ? "Inspect selected consuming organization" : `Inspect ${label}`,
      () => {
        if (select.value !== "") ctx.requestNavigate?.({ type, id: Number(select.value) }, "peek");
      },
    );
    select.before(search);
    select.after(create, inspect);
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
        ...plan.blockers.map((target) =>
          button(target.label, () => {
            ctx.requestNavigate?.({ type: target.type, id: target.id }, "peek");
          }),
        ),
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
    if (recordedRelations && current?.id !== null && current) {
      const rows = relatedEntities(ctx.repo().snapshot(), { type: current.type, id: current.id });
      recordedRelations.replaceChildren(
        el("h3", {}, "Recorded relationships"),
        ...rows.map((row) =>
          el(
            "div",
            { class: "related-record" },
            el("p", {}, `${row.label}: ${row.detail}`),
            button("Inspect", () => {
              ctx.requestNavigate?.(row.target, "peek");
            }),
            button("Open related record", () => {
              ctx.requestNavigate?.(row.target, "edit");
            }),
          ),
        ),
      );
    }
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
            changed("add-consumer");
          },
          { "aria-label": `Remove consumer ${name}`, class: "subtle", id: `remove-consumer-${String(orgId)}` },
        ),
      );
    });
    const consumerPick = el("select", { id: "add-consumer" });
    for (const o of orgs) if (!consumerIds.includes(o.id)) consumerPick.append(option(String(o.id), o.name));
    if (relationIntent.consumer) consumerPick.value = relationIntent.consumer;
    consumerPick.addEventListener("change", () => {
      relationIntent.consumer = consumerPick.value;
      relationIntent.touched = true;
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
    addConsumer.disabled = consumerPick.options.length === 0;

    // Dependencies: services this service relies on, optionally through a CDS.
    const deps = draft.dependencies;
    const depRows = deps.map((dep) => {
      const name = serviceName.get(dep.providerServiceId) ?? "?";
      const provider = services.find((item) => item.id === dep.providerServiceId);
      const via = dep.viaCdsId === null ? "; No CDS recorded" : ` via ${cdsName.get(dep.viaCdsId) ?? "?"}`;
      const route = el("span", { class: "route-edit" });
      const editRoute = button(
        "Edit route",
        () => {
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
              route.replaceChildren(editRoute);
              editRoute.focus();
            }),
          );
          pick.focus();
        },
        { "aria-label": `Edit route to ${name}` },
      );
      route.append(editRoute);
      return el(
        "li",
        {},
        el("span", { class: "row-name" }, `${name}${via} (${networks.get(provider?.networkId ?? 0) ?? "?"})`),
        button(
          `Inspect ${name}`,
          () => {
            ctx.requestNavigate?.({ type: "service", id: dep.providerServiceId }, "peek");
          },
          { class: "subtle" },
        ),
        serviceId === null
          ? null
          : button(`Inspect connection to ${name} (${networks.get(provider?.networkId ?? 0) ?? "?"})`, () => {
              ctx.requestDependency?.(serviceId, dep.providerServiceId);
            }),
        route,
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
    });
    const taken = new Set(deps.map((dep) => dep.providerServiceId));
    const providerPick = el("select", { id: "add-dependency" });
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
      relationIntent.touched = true;
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
    addDependency.disabled = providerPick.options.length === 0;

    relations.replaceChildren(
      el("h3", {}, "Support"),
      ...tiers,
      el("h3", {}, "Consumed by organizations"),
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
    for (const tier of TIERS) {
      const select = relations.querySelector<HTMLSelectElement>(`#support-${String(tier)}`);
      if (select) referenceControls(select, "organization", `Tier ${String(tier)} support`);
    }
    referenceControls(consumerPick, "organization", "Add consumer");
    const incoming = repo.listDependencies().filter((dep) => dep.providerServiceId === serviceId);
    relations.append(
      el("h3", {}, "Used by services"),
      el(
        "ul",
        { "data-testid": "incoming-dependencies", class: "rows" },
        ...incoming.map((dep) => {
          const consumer = services.find((s) => s.id === dep.consumerServiceId);
          const label = `${consumer?.name ?? "Unavailable"} (${networks.get(consumer?.networkId ?? 0) ?? "?"})`;
          return el(
            "li",
            {},
            el("span", {}, label),
            button("Inspect", () => {
              ctx.requestNavigate?.({ type: "service", id: dep.consumerServiceId }, "peek");
            }),
            button("Edit incoming dependency", () => {
              ctx.requestNavigate?.({ type: "service", id: dep.consumerServiceId }, "edit");
            }),
            serviceId === null
              ? null
              : button(`Inspect incoming connection from ${label}`, () => {
                  ctx.requestDependency?.(dep.consumerServiceId, serviceId);
                }),
          );
        }),
      ),
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
