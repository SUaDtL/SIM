import { MARKINGS, type Marking } from "../db/markings";
import { SensitiveInputWarning, ValidationError } from "../domain/errors";
import type { Repository } from "../domain/repository";
import type { ScenarioChange, ScenarioChangeInput } from "../domain/types";
import { applyScenario } from "../scenario/scenario";
import { button, el, option } from "./dom";

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
    return s ? `${s.name} (${networks.get(s.networkId) ?? "?"})` : "?";
  };
  switch (change.kind) {
    case "add":
      return `Add ${change.name} on ${networks.get(change.networkId) ?? "?"} (${change.marking})`;
    case "retire":
      return `Retire ${service(change.serviceId)}`;
    case "merge": {
      const added = all.find((c) => c.id === change.intoChangeId);
      const into =
        change.intoServiceId !== null
          ? service(change.intoServiceId)
          : added?.kind === "add"
            ? `${added.name} (${networks.get(added.networkId) ?? "?"}, added)`
            : "?";
      return `Merge ${service(change.serviceId)} into ${into}`;
    }
    case "rehome": {
      const provider = change.providerOrgId === null ? "" : `, provided by ${orgs.get(change.providerOrgId) ?? "?"}`;
      return `Re-home ${service(change.serviceId)} to ${networks.get(change.networkId) ?? "?"}${provider}`;
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
}

export function createScenarioChanges(
  repo: Repository,
  scenarioId: number,
  onIntentChanged: () => void = () => undefined,
): ScenarioChangeBuilder {
  let all = repo.listScenarioChanges(scenarioId);
  const message = el("p", { class: "message", "data-testid": "change-message", role: "alert" });
  const anyway = el("div", { class: "actions" });
  anyway.hidden = true;
  const rows = el("ul", { class: "rows", "data-testid": "scenario-changes" });
  const empty = el("p", { class: "hint" }, "No changes yet: this scenario matches As-Is.");
  const diagnostics = el("div", { "data-testid": "scenario-diagnostics" });

  const networks = repo.listNetworks();
  const networkName = new Map(networks.map((n) => [n.id, n.name]));
  const services = repo.listServices();
  const changed = new Set(all.flatMap((c) => (c.kind === "add" ? [] : [c.serviceId])));

  const kind = el("select", { id: "change-kind" });
  for (const k of KINDS) kind.append(option(k.value, k.label));
  const service = el("select", { id: "change-service" });
  for (const s of services) {
    if (!changed.has(s.id)) service.append(option(String(s.id), `${s.name} (${networkName.get(s.networkId) ?? "?"})`));
  }
  const into = el("select", { id: "change-into" });
  for (const s of services)
    into.append(option(`service:${String(s.id)}`, `${s.name} (${networkName.get(s.networkId) ?? "?"})`));
  for (const c of all) {
    if (c.kind === "add") {
      into.append(option(`change:${String(c.id)}`, `${c.name} (${networkName.get(c.networkId) ?? "?"}, added)`));
    }
  }
  const network = el("select", { id: "change-network" });
  for (const n of networks) network.append(option(String(n.id), n.name));
  const provider = el("select", { id: "change-provider" }, option("", "(unchanged)"));
  for (const o of repo.listOrganizations()) provider.append(option(String(o.id), o.name));
  const name = el("input", { id: "change-name", type: "text", autocomplete: "off" });
  const marking = el("select", { id: "change-marking" });
  for (const m of MARKINGS) marking.append(option(m, m));

  const fields: Record<string, HTMLElement> = {
    service: el("div", { class: "field" }, el("label", { for: "change-service" }, "Service"), service),
    into: el("div", { class: "field" }, el("label", { for: "change-into" }, "Into"), into),
    name: el("div", { class: "field" }, el("label", { for: "change-name" }, "New service name"), name),
    network: el("div", { class: "field" }, el("label", { for: "change-network" }, "Network"), network),
    marking: el("div", { class: "field" }, el("label", { for: "change-marking" }, "Marking"), marking),
    provider: el("div", { class: "field" }, el("label", { for: "change-provider" }, "Provider"), provider),
  };
  const showFields = () => {
    const uses = USES[kind.value as Kind];
    for (const [key, field] of Object.entries(fields)) field.hidden = !uses.includes(key);
    // An added service has no current provider to keep.
    const none = provider.options[0];
    if (none) none.textContent = kind.value === "add" ? "(none)" : "(unchanged)";
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
    }
  };

  const add = (confirmSensitive: boolean) => {
    withdrawWarning();
    try {
      repo.addScenarioChange(scenarioId, input(), { confirmSensitive });
      clearPendingIntent();
      refresh();
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
    onIntentChanged();
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
      if (wasPending && currentValue !== "" && !choices.some((choice) => choice.value === currentValue)) {
        choices.push({ value: currentValue, label: "(selected target no longer available)" });
      }
      select.replaceChildren(...choices.map((choice) => option(choice.value, choice.label)));
      if (choices.some((choice) => choice.value === currentValue)) select.value = currentValue;
    };
    sync(
      service,
      latestServices
        .filter((item) => !latestChanged.has(item.id))
        .map((item) => ({
          value: String(item.id),
          label: `${item.name} (${latestNetworkNames.get(item.networkId) ?? "?"})`,
        })),
    );
    sync(into, [
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
    sync(
      network,
      latestNetworks.map((item) => ({ value: String(item.id), label: item.name })),
    );
    sync(provider, [
      { value: "", label: kind.value === "add" ? "(none)" : "(unchanged)" },
      ...repo.listOrganizations().map((item) => ({ value: String(item.id), label: item.name })),
    ]);
    if (!wasPending) initial = selected();
    rows.replaceChildren(
      ...all.map((change) => {
        const text = describeChange(repo, change, all);
        return el(
          "li",
          {},
          el("span", { class: "row-name" }, text),
          button(
            "Remove",
            () => {
              try {
                repo.removeScenarioChange(change.id);
                refresh();
              } catch (error) {
                message.textContent = error instanceof ValidationError ? error.message : "Could not remove the change.";
              }
            },
            { "aria-label": `Remove change: ${text}`, class: "subtle" },
          ),
        );
      }),
    );
    empty.hidden = all.length > 0;
    const issues = repo.scenarioNameCollisions(scenarioId);
    const projection = applyScenario(repo.snapshot(), scenarioId).projection;
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
    diagnostics.replaceChildren(
      ...(issues.length > 0
        ? [
            el("p", {}, "This scenario has naming conflicts. Remove or revise a change to repair it."),
            el("ul", {}, ...issues.map((issue) => el("li", {}, issue.message))),
          ]
        : []),
      ...(effects.length > 0 ? [el("ul", {}, ...effects.map((effect) => el("li", {}, effect)))] : []),
    );
    diagnostics.hidden = issues.length === 0 && effects.length === 0;
  }

  const elements = [
    el("h3", {}, "Changes"),
    rows,
    empty,
    diagnostics,
    el(
      "div",
      { class: "add-change" },
      el("div", { class: "field" }, el("label", { for: "change-kind" }, "Change"), kind),
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
  };
}
