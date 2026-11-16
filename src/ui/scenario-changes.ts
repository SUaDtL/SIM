import { MARKINGS, type Marking } from "../db/markings";
import { SensitiveInputWarning, ValidationError } from "../domain/errors";
import type { Repository } from "../domain/repository";
import type { ScenarioChange, ScenarioChangeInput } from "../domain/types";
import { applyScenario, serviceOrigin } from "../scenario/scenario";
import { button, el, focusPagingControl, option } from "./dom";
import type { EntityType } from "./forms";
import { openReferencePicker } from "./reference-picker";
import { collectionPage } from "./relationship-collection";

/**
 * The changes in one scenario (WORK-013): each as a row with Remove, and a form to add one. Every
 * add or remove is its own repository write, so one Undo takes back one change.
 */

const KINDS = [
  { value: "merge", label: "Merge a service into another" },
  { value: "retire", label: "Retire a service" },
  { value: "rehome", label: "Re-home a service" },
  { value: "add", label: "Add a service" },
] as const;
type Kind = (typeof KINDS)[number]["value"];

/** Which inputs each kind of change uses. */
const USES: Record<Kind, readonly string[]> = {
  merge: ["service", "into"],
  retire: ["service"],
  rehome: ["service", "network", "provider"],
  add: ["name", "network", "marking", "provider"],
};

/** One line describing a change, e.g. "Merge Chat (Operations) into Chat (Enterprise)". */
export function describeChange(repo: Repository, change: ScenarioChange, all: readonly ScenarioChange[]): string {
  const networks = new Map(repo.listNetworks().map((n) => [n.id, n.name]));
  const orgs = new Map(repo.listOrganizations().map((o) => [o.id, o.name]));
  const service = (id: number) => {
    const s = repo.getService(id);
    return s ? `${s.name} (${networks.get(s.networkId) ?? "Network unavailable"})` : "Service unavailable";
  };
  switch (change.kind) {
    case "add":
      return `Add ${change.name} on ${networks.get(change.networkId) ?? "Network unavailable"} (${change.marking})`;
    case "retire":
      return `Retire ${service(change.serviceId)}`;
    case "merge": {
      const added = all.find((c) => c.id === change.intoChangeId);
      const into =
        change.intoServiceId !== null
          ? service(change.intoServiceId)
          : added?.kind === "add"
            ? `${added.name} (${networks.get(added.networkId) ?? "Network unavailable"}, added)`
            : "Merge target unavailable";
      return `Merge ${service(change.serviceId)} into ${into}`;
    }
    case "rehome": {
      const provider =
        change.providerOrgId === null
          ? ""
          : `, provided by ${orgs.get(change.providerOrgId) ?? "Organization unavailable"}`;
      return `Re-home ${service(change.serviceId)} to ${networks.get(change.networkId) ?? "Network unavailable"}${provider}`;
    }
  }
}

export interface ScenarioChangeBuilder {
  readonly elements: HTMLElement[];
  /** A changed builder is an unapplied editor intent, even when metadata is clean. */
  hasPendingIntent(): boolean;
  collectPendingIntent(): ScenarioChangeInput | null;
  clearPendingIntent(): void;
  showError(error: ValidationError | SensitiveInputWarning, retryConfirmed?: () => void): void;
  /** Refresh committed rows and diagnostics without touching builder controls or focus. */
  refresh(): void;
  /** Reveal the exact authored change without changing the builder or metadata. */
  revealChange(changeId: number): boolean;
}

export function createScenarioChanges(
  repo: Repository,
  scenarioId: number,
  onIntentChanged: () => void = () => undefined,
  onInspect?: (target: { type: EntityType; id: number; changeId?: number }) => void,
): ScenarioChangeBuilder {
  let all = repo.listScenarioChanges(scenarioId);
  const message = el("p", { class: "message", "data-testid": "change-message", role: "alert" });
  const anyway = el("div", { class: "actions" });
  anyway.hidden = true;
  const rows = el("ul", { class: "rows", "data-testid": "scenario-changes" });
  const empty = el("p", { class: "hint" }, "No proposed changes yet.");
  const diagnostics = el("div", { "data-testid": "scenario-diagnostics" });
  let page = 0;
  let revealedChangeId: number | null = null;
  const query = el("input", {
    type: "search",
    "aria-label": "Search scenario changes",
    placeholder: "Search changes, services or networks",
  });
  const count = el("p", { class: "hint", role: "status", "data-testid": "scenario-change-count" });
  const previous = button(
    "Previous",
    () => {
      page--;
      renderRows();
      focusPagingControl(previous, next);
    },
    { "aria-label": "Previous scenario changes page" },
  );
  const next = button(
    "Next",
    () => {
      page++;
      renderRows();
      focusPagingControl(next, previous);
    },
    { "aria-label": "Next scenario changes page" },
  );
  const paging = el("div", { class: "relationship-paging" }, previous, next);
  query.addEventListener("input", () => {
    page = 0;
    renderRows();
  });

  const kind = el("select", { id: "change-kind" }, option("", "Choose a change"));
  for (const k of KINDS) kind.append(option(k.value, k.label));
  const service = el("select", { id: "change-service" }, option("", "Choose a service"));
  const into = el("select", { id: "change-into" }, option("", "Choose a merge target"));
  const network = el("select", { id: "change-network" }, option("", "Choose a network"));
  const provider = el("select", { id: "change-provider" }, option("", "(unchanged)"));
  const name = el("input", { id: "change-name", type: "text", autocomplete: "off" });
  const marking = el("select", { id: "change-marking" });
  for (const m of MARKINGS) marking.append(option(m, m));
  const prerequisite = el("p", { class: "hint", role: "status", "data-testid": "scenario-builder-guidance" });

  const fields: Record<string, HTMLElement> = {
    service: el("div", { class: "field" }, el("label", { for: "change-service" }, "Service"), service),
    into: el("div", { class: "field" }, el("label", { for: "change-into" }, "Into"), into),
    name: el("div", { class: "field" }, el("label", { for: "change-name" }, "New service name"), name),
    network: el("div", { class: "field" }, el("label", { for: "change-network" }, "Network"), network),
    marking: el("div", { class: "field" }, el("label", { for: "change-marking" }, "Marking"), marking),
    provider: el("div", { class: "field" }, el("label", { for: "change-provider" }, "Provider"), provider),
  };
  const pickerUpdates: (() => void)[] = [];
  const addPicker = (select: HTMLSelectElement, label: string): void => {
    select.hidden = true;
    const trigger = button(
      "",
      () => {
        openReferencePicker({
          label,
          selectedValue: select.value,
          allowNone: select === provider,
          ...(select === provider
            ? { noneLabel: kind.value === "rehome" ? "Keep existing provider" : "Provider not recorded" }
            : {}),
          returnFocus: trigger,
          isCurrent: () => trigger.isConnected && repo.getScenario(scenarioId) !== undefined,
          options: () =>
            [...select.options]
              .filter((item) => item.value !== "" && !item.disabled)
              .map((item) => ({ value: item.value, label: item.text })),
          onSelect: (value) => {
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          },
        });
      },
      {
        id: `${select.id}-choose`,
        class: "reference-field",
        "aria-label": `Choose ${label}`,
        "aria-haspopup": "dialog",
      },
    );
    const update = () => {
      trigger.textContent = select.selectedOptions[0]?.text ?? `Choose ${label}`;
    };
    select.before(trigger);
    select.addEventListener("change", update);
    pickerUpdates.push(update);
    update();
  };
  addPicker(service, "scenario source service");
  addPicker(into, "scenario merge target");
  addPicker(network, "scenario network");
  addPicker(provider, "scenario provider");
  const showFields = () => {
    const uses = kind.value === "" ? [] : USES[kind.value as Kind];
    for (const [key, field] of Object.entries(fields)) field.hidden = !uses.includes(key);
    // An added service has no current provider to keep.
    const none = provider.options[0];
    if (none) none.textContent = kind.value === "add" ? "Provider not recorded" : "Keep existing provider";
    prerequisite.textContent =
      kind.value === ""
        ? "Choose what you want to propose, then choose the affected records."
        : (kind.value === "add" || kind.value === "rehome") && network.options.length <= 1
          ? "Add a network to the recorded enterprise before proposing this change."
          : kind.value !== "add" && service.options.length <= 1
            ? "No unchanged services are available. Add a service to the recorded enterprise or choose Add a service."
            : "";
    prerequisite.hidden = prerequisite.textContent === "";
    for (const update of pickerUpdates) update();
  };
  kind.addEventListener("change", showFields);
  showFields();

  const controls = [kind, service, into, network, provider, name, marking] as const;
  const selected = () => JSON.stringify(controls.map((control) => control.value));
  let initial = selected();
  let warningSignature: string | null = null;
  let retryWarning: (() => void) | null = null;
  const withdrawWarning = () => {
    warningSignature = null;
    retryWarning = null;
    anyway.hidden = true;
    message.textContent = "";
  };
  for (const control of controls) {
    control.addEventListener(control === name ? "input" : "change", () => {
      withdrawWarning();
      onIntentChanged();
    });
  }

  const hasPendingIntent = () => selected() !== initial;

  const input = (): ScenarioChangeInput => {
    if (!KINDS.some((item) => item.value === kind.value)) {
      throw new ValidationError("REQUIRED", "kind", "Choose a change before adding it.");
    }
    if (kind.value === "add" && !name.value.trim())
      throw new ValidationError("REQUIRED", "name", "A new service name is required.");
    if (USES[kind.value as Kind].includes("service") && !service.value)
      throw new ValidationError("REQUIRED", "service", "Choose the service to change.");
    if (USES[kind.value as Kind].includes("into") && !into.value)
      throw new ValidationError("REQUIRED", "into", "Choose the merge target.");
    if (USES[kind.value as Kind].includes("network") && !network.value)
      throw new ValidationError("REQUIRED", "network", "Choose a network for this change.");
    const providerOrgId = provider.value === "" ? null : Number(provider.value);
    switch (kind.value as Kind) {
      case "add":
        return {
          kind: "add",
          name: name.value,
          networkId: Number(network.value),
          // The repository checks the marking again.
          marking: marking.value as Marking,
          providerOrgId,
        };
      case "retire":
        return { kind: "retire", serviceId: Number(service.value) };
      case "rehome":
        return { kind: "rehome", serviceId: Number(service.value), networkId: Number(network.value), providerOrgId };
      case "merge": {
        const [what, id] = into.value.split(":");
        return what === "change"
          ? { kind: "merge", serviceId: Number(service.value), intoChangeId: Number(id) }
          : { kind: "merge", serviceId: Number(service.value), intoServiceId: Number(id) };
      }
    }
  };
  const relevantSignature = (): string => {
    const value = input();
    const source = value.kind === "add" ? null : repo.getService(value.serviceId);
    const target =
      value.kind === "merge" && typeof value.intoServiceId === "number" ? repo.getService(value.intoServiceId) : null;
    const networkRecord = value.kind === "add" || value.kind === "rehome" ? repo.getNetwork(value.networkId) : null;
    const providerRecord =
      (value.kind === "add" || value.kind === "rehome") && typeof value.providerOrgId === "number"
        ? repo.getOrganization(value.providerOrgId)
        : null;
    const addedTarget =
      value.kind === "merge" && typeof value.intoChangeId === "number"
        ? repo.listScenarioChanges(scenarioId).find((change) => change.id === value.intoChangeId)
        : null;
    return JSON.stringify({
      value,
      scenario: repo.getScenario(scenarioId),
      source,
      target,
      networkRecord,
      providerRecord,
      addedTarget,
      changes: repo.listScenarioChanges(scenarioId),
    });
  };

  const showError = (error: ValidationError | SensitiveInputWarning, retryConfirmed?: () => void): void => {
    withdrawWarning();
    if (error instanceof SensitiveInputWarning) {
      message.textContent = `${error.message} Add it anyway only if it is not a real host name or address.`;
      warningSignature = relevantSignature();
      retryWarning = retryConfirmed ?? null;
      anyway.hidden = false;
    } else {
      message.textContent = error.message;
      const field =
        error.field === "kind"
          ? kind
          : error.field === "name"
            ? name
            : fields[error.field]?.querySelector<HTMLElement>("button, input, select");
      field?.focus();
    }
  };

  const add = (confirmSensitive: boolean) => {
    withdrawWarning();
    try {
      const change = repo.addScenarioChange(scenarioId, input(), { confirmSensitive });
      clearPendingIntent();
      // Successful creation must be visible even when the previous search excluded this row.
      revealChange(change.id);
    } catch (error) {
      if (error instanceof SensitiveInputWarning) {
        showError(error, () => {
          add(true);
        });
      } else if (error instanceof ValidationError) showError(error);
      else throw error;
    }
  };
  anyway.append(
    button("Add anyway", () => {
      if (warningSignature === null || relevantSignature() !== warningSignature) {
        withdrawWarning();
        message.textContent = "The scenario or selected target changed. Review this change and submit it again.";
        return;
      }
      retryWarning?.();
    }),
  );

  function clearPendingIntent(): void {
    for (const control of controls) {
      if (control instanceof HTMLInputElement) control.value = "";
      else control.selectedIndex = 0;
    }
    showFields();
    withdrawWarning();
    // Repository listeners may refresh choices during the write. Consume only this builder's
    // submitted intent, then baseline again after unavailable source choices have been removed.
    initial = selected();
    refresh();
    initial = selected();
    onIntentChanged();
  }

  function renderRows(): void {
    const result = collectionPage(
      all.map((change) => ({ label: describeChange(repo, change, all), detail: "", change })),
      query.value,
      page,
    );
    page = result.page;
    rows.replaceChildren(
      ...result.rows.map(({ label, change }) =>
        el(
          "li",
          {
            "data-change-id": String(change.id),
            tabindex: "-1",
            ...(revealedChangeId === change.id ? { "aria-current": "true" } : {}),
          },
          el("span", { class: "row-name" }, label),
          button(
            "Remove",
            () => {
              try {
                repo.removeScenarioChange(change.id);
                refresh();
                const alternative = rows.querySelector<HTMLButtonElement>("button");
                if (alternative) alternative.focus();
                else query.focus();
              } catch (error) {
                message.textContent = error instanceof ValidationError ? error.message : "Could not remove the change.";
              }
            },
            { "aria-label": `Remove change: ${label}`, class: "subtle" },
          ),
        ),
      ),
    );
    count.textContent = `${String(result.first)}–${String(result.last)} of ${String(result.total)}${query.value.trim() ? ` matching (${String(all.length)} recorded)` : ""}`;
    empty.hidden = result.total > 0;
    empty.textContent =
      all.length === 0
        ? "No proposed changes yet."
        : "No changes match your search. Try another service or network name.";
    previous.disabled = result.page === 0;
    next.disabled = result.page + 1 >= result.pages;
    paging.hidden = result.pages === 1;
  }

  function revealChange(changeId: number): boolean {
    const index = all.findIndex((change) => change.id === changeId);
    if (index < 0) return false;
    query.value = "";
    page = Math.floor(index / 20);
    revealedChangeId = changeId;
    renderRows();
    const row = [...rows.querySelectorAll<HTMLElement>("li")].find(
      (item) => item.dataset["changeId"] === String(changeId),
    );
    row?.focus();
    row?.scrollIntoView({ block: "nearest" });
    return true;
  }

  function refresh(): void {
    const wasPending = hasPendingIntent();
    all = repo.listScenarioChanges(scenarioId);
    const latestNetworks = repo.listNetworks();
    const latestNetworkNames = new Map(latestNetworks.map((item) => [item.id, item.name]));
    const latestServices = repo.listServices();
    const latestChanged = new Set(all.flatMap((change) => (change.kind === "add" ? [] : [change.serviceId])));
    const sync = (select: HTMLSelectElement, choices: { value: string; label: string }[]): void => {
      const currentValue = select.value;
      const missing = wasPending && currentValue !== "" && !choices.some((choice) => choice.value === currentValue);
      if (missing) {
        choices.push({ value: currentValue, label: "(selected target no longer available)" });
      }
      select.replaceChildren(...choices.map((choice) => option(choice.value, choice.label)));
      if (choices.some((choice) => choice.value === currentValue)) select.value = currentValue;
      if (missing && select.selectedOptions[0]) select.selectedOptions[0].disabled = true;
    };
    sync(service, [
      { value: "", label: "Choose a service" },
      ...latestServices
        .filter((item) => !latestChanged.has(item.id))
        .map((item) => ({
          value: String(item.id),
          label: `${item.name} (${latestNetworkNames.get(item.networkId) ?? "?"})`,
        })),
    ]);
    sync(into, [
      { value: "", label: "Choose a merge target" },
      ...latestServices.map((item) => ({
        value: `service:${String(item.id)}`,
        label: `${item.name} (${latestNetworkNames.get(item.networkId) ?? "?"})`,
      })),
      ...all
        .filter((change) => change.kind === "add")
        .map((change) => ({
          value: `change:${String(change.id)}`,
          label: `${change.name} (${latestNetworkNames.get(change.networkId) ?? "?"}, added)`,
        })),
    ]);
    sync(network, [
      { value: "", label: "Choose a network" },
      ...latestNetworks.map((item) => ({ value: String(item.id), label: item.name })),
    ]);
    sync(provider, [
      { value: "", label: kind.value === "add" ? "Provider not recorded" : "Keep existing provider" },
      ...repo.listOrganizations().map((item) => ({ value: String(item.id), label: item.name })),
    ]);
    showFields();
    if (!wasPending) initial = selected();
    renderRows();
    const issues = repo.scenarioNameCollisions(scenarioId);
    const projected = applyScenario(repo.snapshot(), scenarioId);
    const projection = projected.projection;
    const unresolved = [...projection.dependencyProvenance.values()].filter(
      (dependency) => dependency.status === "unresolved",
    );
    const impact = projection.impacts;
    const effects = [
      unresolved.length > 0
        ? `${String(unresolved.length)} dependency route${unresolved.length === 1 ? " is" : "s are"} unresolved: ${[...new Set(unresolved.map((dependency) => dependency.reason ?? "route unavailable"))].join("; ")}. No direct route is established by this projection.`
        : "",
      impact.droppedSupport.length > 0
        ? `${String(impact.droppedSupport.length)} support assignment${impact.droppedSupport.length === 1 ? " is" : "s are"} dropped when services merge.`
        : "",
      impact.transferredConsumption.length > 0
        ? `${String(impact.transferredConsumption.length)} consumer link${impact.transferredConsumption.length === 1 ? " transfers" : "s transfer"} to merge targets.`
        : "",
      impact.transferredDependencies.length > 0
        ? `${String(impact.transferredDependencies.length)} dependency link${impact.transferredDependencies.length === 1 ? " transfers" : "s transfer"} to merge targets.`
        : "",
      impact.coalescedDependencies.length > 0
        ? `${String(impact.coalescedDependencies.length)} dependency link${impact.coalescedDependencies.length === 1 ? " is" : "s are"} coalesced in the projection.`
        : "",
    ].filter(Boolean);
    const targets = new Map<string, { type: EntityType; id: number; label: string; changeId?: number }>();
    const addTarget = (type: EntityType, id: number, label: string, changeId?: number): void => {
      targets.set(`${type}:${String(id)}:${changeId === undefined ? "" : String(changeId)}`, {
        type,
        id,
        label,
        ...(changeId === undefined ? {} : { changeId }),
      });
    };
    const addChange = (change: ScenarioChange): void => {
      addTarget("scenario", change.scenarioId, `Review: ${describeChange(repo, change, all)}`, change.id);
    };
    const addService = (id: number): void => {
      const origin = serviceOrigin(projected, id);
      if (origin.kind === "planned") {
        const change = all.find((item) => item.id === origin.changeId);
        if (change) addChange(change);
        return;
      }
      const record = repo.getService(origin.serviceId);
      if (!record) return;
      const network = repo.getNetwork(record.networkId);
      addTarget("service", record.id, `Inspect service ${record.name} (${network?.name ?? "Unavailable"})`);
    };
    for (const issue of issues) {
      for (const id of issue.serviceIds) addService(id);
      for (const change of all) {
        if (change.kind === "add") continue;
        if (
          issue.serviceIds.includes(change.serviceId) ||
          (change.kind === "merge" && change.intoServiceId !== null && issue.serviceIds.includes(change.intoServiceId))
        )
          addChange(change);
      }
      const network = repo.getNetwork(issue.networkId);
      if (network) addTarget("network", network.id, `Inspect affected network ${network.name}`);
    }
    for (const route of unresolved) {
      for (const source of route.sourceDependencies) {
        // Source provenance uses stored baseline IDs, never projected IDs or parsed display names.
        for (const id of [source.consumerServiceId, source.providerServiceId]) {
          const record = repo.getService(id);
          if (record)
            addTarget(
              "service",
              id,
              `Inspect service ${record.name} (${repo.getNetwork(record.networkId)?.name ?? "Unavailable"})`,
            );
        }
      }
      for (const id of route.previousViaCdsIds) {
        const cds = repo.getCds(id);
        if (cds) addTarget("cds", id, `Inspect CDS ${cds.name}`);
      }
      for (const id of route.responsibleChangeIds) {
        const change = all.find((item) => item.id === id);
        if (change) addChange(change);
      }
    }
    diagnostics.replaceChildren(
      ...(issues.length > 0
        ? [
            el(
              "p",
              {},
              "This scenario has naming conflicts. Review the affected changes, then remove and re-add a change with corrected choices.",
            ),
            el("ul", {}, ...issues.map((issue) => el("li", {}, issue.message))),
          ]
        : []),
      ...(effects.length > 0 ? [el("ul", {}, ...effects.map((effect) => el("li", {}, effect)))] : []),
      ...[...targets.values()].map((target) => {
        const control = button(target.label, () => {
          onInspect?.({
            type: target.type,
            id: target.id,
            ...(target.changeId === undefined ? {} : { changeId: target.changeId }),
          });
        });
        control.disabled = onInspect === undefined;
        return control;
      }),
    );
    diagnostics.hidden = issues.length === 0 && effects.length === 0;
  }

  const elements = [
    el("h3", {}, "Changes"),
    el(
      "p",
      { class: "hint", "data-testid": "scenario-command-guidance" },
      "Add change and Remove take effect immediately. Undo reverses them. Cancel or Discard drops only changes you have not applied.",
    ),
    query,
    count,
    rows,
    empty,
    paging,
    diagnostics,
    el(
      "div",
      { class: "add-change" },
      el("div", { class: "field" }, el("label", { for: "change-kind" }, "Change"), kind),
      prerequisite,
      ...Object.values(fields),
      button("Add change", () => {
        add(false);
      }),
    ),
    message,
    anyway,
  ];
  refresh();
  return {
    elements,
    hasPendingIntent,
    collectPendingIntent: () => (hasPendingIntent() ? input() : null),
    clearPendingIntent,
    showError,
    refresh,
    revealChange,
  };
}
