import type { Repository } from "../domain/repository";
import type { ExchangeTable } from "../domain/assessment-context";
import type { Viewpoint } from "../map/viewpoint";
import { applyScenario, compareScenario, serviceOrigin } from "../scenario/scenario";
import type { Snapshot } from "../domain/types";

/** One read context for a visible page. Stored UUIDs refer to today's records and projected subjects. */
export function viewSummaryReader(repo: Repository) {
  const snapshot = repo.snapshot();
  const ids = new Map<ExchangeTable, Map<string, string>>();
  function key(table: ExchangeTable, uuid: string) {
    let keys = ids.get(table);
    if (!keys) {
      keys = new Map([...repo.exchangeIdentities(table)].map(([local, identity]) => [identity, local]));
      ids.set(table, keys);
    }
    const id = keys.get(uuid);
    return id === undefined ? undefined : Number(id);
  }
  const snapshots = new Map<string, Snapshot>();
  return (view: Viewpoint) => {
    let projected: Snapshot | undefined = snapshot;
    let perspective = "As-Is";
    if (view.scenario !== null) {
      const id = key("scenario", view.scenario);
      const scenario = snapshot.scenarios.find((row) => row.id === id);
      perspective = `${view.projection === "compare" ? "Compare" : "To-Be"} · ${scenario?.name ?? "Scenario unavailable"}`;
      if (scenario) {
        const address = `${view.projection}/${view.scenario}`;
        projected = snapshots.get(address);
        if (!projected) {
          projected =
            view.projection === "compare"
              ? compareScenario(snapshot, scenario.id).overlay
              : applyScenario(snapshot, scenario.id);
          snapshots.set(address, projected);
        }
      } else projected = undefined;
    }
    function name(subject: NonNullable<Viewpoint["selection"]>): string {
      const { kind, identity } = subject;
      const id = key(kind === "planned" ? "scenario_change" : kind, identity);
      let label: string | undefined;
      if (kind === "network") label = projected?.networks.find((row) => row.id === id)?.name;
      else if (kind === "cds") label = projected?.cds.find((row) => row.id === id)?.name;
      else if (projected) {
        const current = projected;
        const service = current.services.find((row) => {
          const origin = serviceOrigin(current, row.id);
          return kind === "planned"
            ? origin.kind === "planned" && origin.changeId === id
            : origin.kind === "baseline" && origin.serviceId === id;
        });
        if (service)
          label = `${service.name} (${current.networks.find((row) => row.id === service.networkId)?.name ?? "Network unavailable"})`;
      }
      return label ?? `Unavailable ${kind === "planned" ? "proposed service" : kind}`;
    }
    const scope: string[] = [];
    for (const field of ["network", "category", "organization"] as const) {
      const identity = view.filters[field];
      if (!identity) continue;
      const records =
        field === "network" ? snapshot.networks : field === "category" ? snapshot.categories : snapshot.organizations;
      const id = key(field, identity);
      scope.push(
        `${field[0]?.toUpperCase() ?? ""}${field.slice(1)}: ${records.find((row) => row.id === id)?.name ?? "Unavailable"}`,
      );
    }
    if (!scope.length) scope.push("All networks · All categories · All organizations");
    scope.push(view.foundational ? "Foundational dependencies shown" : "Foundational dependencies hidden");
    const detail: string[] = [];
    if (view.selection) detail.push(`Selected: ${name(view.selection)}`);
    if (view.focus) {
      const labels = { "depends-on": "Depends on", "used-by": "Used by", "network-connections": "Network connections" };
      detail.push(`${labels[view.focus.kind]} · ${name(view.focus.subject)} · depth ${String(view.focus.depth)}`);
    }
    if (view.chain) detail.push(`Highlighted chain: ${name(view.chain)}`);
    if (!detail.length) detail.push("Overview · No selected subject");
    return { perspective, scope: scope.join(" · "), detail: detail.join(" · ") };
  };
}
