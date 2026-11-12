import { SensitiveInputWarning, ValidationError } from "../domain/errors";
import type { Repository } from "../domain/repository";
import type { Tier } from "../domain/types";
import { button, el, option } from "./dom";
import {
  descriptor,
  type EntityType,
  type FieldDef,
  fieldFor,
  type FormValues,
  nounOf,
  suggestsFoundational,
} from "./forms";
import type { Selection } from "./list-panel";
import { scenarioChanges } from "./scenario-changes";

export interface EditorContext {
  repo(): Repository;
  /** The editor opened, saved or closed an item; the list should update its highlight. */
  selectionChanged(): void;
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

  function placeholder(): void {
    element.replaceChildren(el("p", { class: "empty" }, "Select an item or add one."));
  }

  function close(): void {
    current = null;
    relations = null;
    placeholder();
    ctx.selectionChanged();
  }

  function open(type: EntityType, id: number | null, noticeText = ""): void {
    const repo = ctx.repo();
    const d = descriptor(type);
    const noun = nounOf(type);
    current = { type, id };
    const values = d.values(repo, id);

    const errors = new Map<string, HTMLElement>();
    const controls = new Map<string, () => FormValues[string]>();
    const fields = d.fields.map((f) => renderField(repo, f, values, id, errors, controls));

    const message = el("p", { class: "message", "data-testid": "editor-message", role: "alert" });
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
    warning.append(
      button(
        "Save anyway",
        () => {
          if (pending) save(pending, true);
        },
        { class: "danger" },
      ),
    );

    const collect = (): FormValues => {
      const out: FormValues = {};
      for (const [key, read] of controls) out[key] = read();
      return out;
    };
    const clearErrors = (): void => {
      for (const e of errors.values()) {
        e.textContent = "";
        e.hidden = true;
      }
      message.textContent = "";
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

    function save(input: FormValues, confirmSensitive: boolean): void {
      clearErrors();
      try {
        const savedId = d.save(ctx.repo(), id, input, { confirmSensitive });
        open(type, savedId, `${d.label} saved.`);
        ctx.selectionChanged();
      } catch (error) {
        if (error instanceof SensitiveInputWarning) {
          pending = input;
          warningList.replaceChildren(
            ...error.findings.map((f) => el("li", {}, `${f.field}: ${f.matches.join(", ")}`)),
          );
          warning.hidden = false;
        } else if (error instanceof ValidationError) {
          showError(error.field, error.message);
        } else {
          message.textContent = describe(error);
        }
      }
    }

    const form = el("form", { class: "entity-form", novalidate: "" }, ...fields, warning, message, notice);
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
      warning.hidden = true;
    });

    const actions = el("div", { class: "actions" }, el("button", { type: "submit", class: "primary" }, `Save ${noun}`));
    if (id !== null) actions.append(deleteControl(type, id, noun, message));
    form.append(actions);

    relations = (type === "service" || type === "scenario") && id !== null ? el("div", { class: "relations" }) : null;
    element.replaceChildren(el("h2", {}, `${id === null ? "New" : "Edit"} ${noun}`), form, relations ?? "");
    renderRelations();
    ctx.selectionChanged();
  }

  /** While a new service is unsaved, picking its network also picks that network's marking. */
  function followNetworkMarking(form: HTMLFormElement): void {
    const network = form.querySelector<HTMLSelectElement>("#field-networkId");
    const marking = form.querySelector<HTMLSelectElement>("#field-marking");
    network?.addEventListener("change", () => {
      const chosen = ctx.repo().getNetwork(Number(network.value));
      if (chosen && marking) marking.value = chosen.marking;
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
      box.replaceChildren(
        button(
          "Confirm delete",
          () => {
            try {
              descriptor(type).remove(ctx.repo(), id);
              close();
            } catch (error) {
              message.textContent = describe(error);
              reset();
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
      relations.replaceChildren(...scenarioChanges(ctx.repo(), current.id));
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
    const attempt = (write: () => void): void => {
      try {
        write();
      } catch (error) {
        message.textContent = describe(error);
      }
    };

    // Support: one organization per tier; each change is its own write.
    const support = repo.listSupport(serviceId);
    const tiers = TIERS.map((tier) => {
      const existing = support.find((s) => s.tier === tier);
      const id = `support-${String(tier)}`;
      const select = el("select", { id }, option("", "(none)"));
      for (const o of orgs) select.append(option(String(o.id), o.name, existing?.orgId === o.id));
      select.addEventListener("change", () => {
        attempt(() => {
          // Notes are already stored and were confirmed when entered, so they are passed back unchanged.
          repo.setSupport(serviceId, tier, select.value === "" ? null : Number(select.value), existing?.notes, {
            confirmSensitive: true,
          });
        });
      });
      return el("div", { class: "field" }, el("label", { for: id }, `Tier ${String(tier)} support`), select);
    });

    // Consumers: organizations that use this service.
    const consumerIds = repo
      .listConsumption()
      .filter((c) => c.serviceId === serviceId)
      .map((c) => c.orgId);
    const consumerRows = consumerIds.map((orgId) => {
      const name = orgName.get(orgId) ?? "?";
      return el(
        "li",
        {},
        el("span", { class: "row-name" }, name),
        button(
          "Remove",
          () => {
            attempt(() => {
              repo.removeConsumption(orgId, serviceId);
            });
          },
          { "aria-label": `Remove consumer ${name}`, class: "subtle" },
        ),
      );
    });
    const consumerPick = el("select", { id: "add-consumer" });
    for (const o of orgs) if (!consumerIds.includes(o.id)) consumerPick.append(option(String(o.id), o.name));
    const addConsumer = button("Add consumer", () => {
      if (consumerPick.value === "") return;
      attempt(() => {
        repo.addConsumption(Number(consumerPick.value), serviceId);
      });
    });
    addConsumer.disabled = consumerPick.options.length === 0;

    // Dependencies: services this service relies on, optionally through a CDS.
    const deps = repo.listDependencies().filter((dep) => dep.consumerServiceId === serviceId);
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
            attempt(() => {
              repo.removeDependency(serviceId, dep.providerServiceId);
            });
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
      attempt(() => {
        repo.addDependency({
          consumerServiceId: serviceId,
          providerServiceId: Number(providerPick.value),
          viaCdsId: viaPick.value === "" ? null : Number(viaPick.value),
        });
      });
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
      close();
      return;
    }
    renderRelations();
  }

  function reload(): void {
    if (!current || current.id === null) return;
    if (descriptor(current.type).get(ctx.repo(), current.id) === undefined) close();
    else open(current.type, current.id);
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
