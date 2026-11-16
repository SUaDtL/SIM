import type { DatasetIssue } from "../db/semantics";
import type { Snapshot } from "../domain/types";

/** Human-readable projection of an issue; its exact stored-row witness stays in technical details. */
export function describeDataIssue(issue: DatasetIssue, snapshot: Snapshot): string {
  const id = Number(issue.rowId.split(":")[0]);
  const network = (networkId: number) =>
    snapshot.networks.find((item) => item.id === networkId)?.name ?? "Unavailable network";
  const service = (serviceId: number | null | undefined): string => {
    const item = snapshot.services.find((entry) => entry.id === serviceId);
    return item ? `${item.name} (${network(item.networkId)})` : "Unavailable service";
  };
  switch (issue.code) {
    case "UNSAFE_ID":
      return "This record has an identity outside SIM's exact supported range. Open a verified file copy.";
    case "CDS_ARITY": {
      const cds = snapshot.cds.find((item) => item.id === id);
      const joined = cds?.networkIds.map(network).join(", ") || "No networks recorded";
      return `${cds?.name ?? "Unavailable CDS"} must join at least two networks. Currently joined: ${joined}.`;
    }
    case "CDS_ROUTE": {
      const provider = Number(issue.rowId.split(":")[1]);
      const dependency = snapshot.dependencies.find(
        (item) => item.consumerServiceId === id && item.providerServiceId === provider,
      );
      const cds = snapshot.cds.find((item) => item.id === dependency?.viaCdsId);
      return `${service(id)} depends on ${service(provider)}. ${cds?.name ?? "The recorded CDS"} does not provide a valid route between these networks. Its joined networks are: ${cds?.networkIds.map(network).join(", ") || "none recorded"}. Review the connection route.`;
    }
    case "ORG_CYCLE": {
      const names: string[] = [];
      const seen = new Set<number>();
      let at: number | null = id;
      while (at !== null && !seen.has(at)) {
        seen.add(at);
        const item = snapshot.organizations.find((entry) => entry.id === at);
        if (!item) break;
        names.push(item.name);
        at = item.parentId;
      }
      if (at !== null)
        names.push(snapshot.organizations.find((item) => item.id === at)?.name ?? "Unavailable organization");
      return `The organization hierarchy forms a loop: ${names.join(" → ")}. Choose a parent outside this loop.`;
    }
    case "SCENARIO_TARGET":
    case "SCENARIO_CHAIN": {
      const change = snapshot.scenarioChanges.find((item) => item.id === id);
      const scenario =
        snapshot.scenarios.find((item) => item.id === change?.scenarioId)?.name ?? "Unavailable scenario";
      if (issue.code === "SCENARIO_CHAIN")
        return `${scenario} contains a loop of service merges. Review the source and destination changes${change && "serviceId" in change ? ` for ${service(change.serviceId)}` : ""}.`;
      const planned =
        change?.kind === "merge" ? snapshot.scenarioChanges.find((item) => item.id === change.intoChangeId) : undefined;
      const target =
        planned?.kind === "add"
          ? `${planned.name} (planned)`
          : change?.kind === "merge"
            ? service(change.intoServiceId)
            : "an unavailable target";
      return `${scenario}: the merge${change?.kind === "merge" ? ` of ${service(change.serviceId)}` : ""} cannot use ${target} as its destination. Review the proposal's source and target changes.`;
    }
  }
}
