import { MARKINGS, type Marking } from "../db/markings";
import { SensitiveInputWarning, ValidationError } from "../domain/errors";
import type { Repository } from "../domain/repository";
import type { ScenarioChange, ScenarioChangeInput } from "../domain/types";
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

export function scenarioChanges(repo: Repository, scenarioId: number): HTMLElement[] {
  const all = repo.listScenarioChanges(scenarioId);
  const message = el("p", { class: "message", "data-testid": "change-message", role: "alert" });
  const anyway = el("div", { class: "actions" });
  anyway.hidden = true;

  const rows = all.map((c) => {
    const text = describeChange(repo, c, all);
    return el(
      "li",
      {},
      el("span", { class: "row-name" }, text),
      button(
        "Remove",
        () => {
          try {
            repo.removeScenarioChange(c.id);
          } catch (error) {
            message.textContent = error instanceof ValidationError ? error.message : "Could not remove the change.";
          }
        },
        { "aria-label": `Remove change: ${text}`, class: "subtle" },
      ),
    );
  });

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
  const add = (confirmSensitive: boolean) => {
    anyway.hidden = true;
    try {
      repo.addScenarioChange(scenarioId, input(), { confirmSensitive });
    } catch (error) {
      if (error instanceof SensitiveInputWarning) {
        message.textContent = `${error.message} Add it anyway only if it is not a real host name or address.`;
        anyway.hidden = false;
      } else if (error instanceof ValidationError) message.textContent = error.message;
      else throw error;
    }
  };
  anyway.append(
    button("Add anyway", () => {
      add(true);
    }),
  );

  return [
    el("h3", {}, "Changes"),
    el("ul", { class: "rows", "data-testid": "scenario-changes" }, ...rows),
    ...(all.length === 0 ? [el("p", { class: "hint" }, "No changes yet: this scenario matches As-Is.")] : []),
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
}
