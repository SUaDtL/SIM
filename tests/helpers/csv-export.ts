import type { Snapshot } from "../../src/domain/types";
import type { TemplateType } from "../../src/import/templates";

/** Every template's rows for a snapshot, filled in as a user would, in the templates' column order. */
export function snapshotRows(s: Snapshot): Record<TemplateType, string[][]> {
  const net = (id: number) => s.networks.find((n) => n.id === id)?.name ?? "";
  const org = (id: number | null) => s.organizations.find((o) => o.id === id)?.name ?? "";
  const svc = (id: number) => s.services.find((x) => x.id === id);
  const svcNet = (id: number) => net(svc(id)?.networkId ?? 0);
  return {
    networks: s.networks.map((n) => [n.name, n.kind, n.marking, n.description ?? ""]),
    organizations: s.organizations.map((o) => [o.name, org(o.parentId)]),
    categories: s.categories.map((c) => [c.name, c.color ?? ""]),
    applications: s.applications.map((a) => [a.name, a.vendor ?? "", a.description ?? ""]),
    services: s.services.map((x) => [
      x.name,
      net(x.networkId),
      x.marking,
      s.applications.find((a) => a.id === x.applicationId)?.name ?? "",
      s.categories.find((c) => c.id === x.categoryId)?.name ?? "",
      org(x.providerOrgId),
      x.foundational ? "yes" : "no",
      x.description ?? "",
    ]),
    cds: s.cds.map((c) => [c.name, c.networkIds.map(net).join("; "), c.description ?? ""]),
    support: s.support.map((x) => [
      svc(x.serviceId)?.name ?? "",
      svcNet(x.serviceId),
      String(x.tier),
      org(x.orgId),
      x.notes ?? "",
    ]),
    consumers: s.consumption.map((c) => [org(c.orgId), svc(c.serviceId)?.name ?? "", svcNet(c.serviceId)]),
    dependencies: s.dependencies.map((d) => [
      svc(d.consumerServiceId)?.name ?? "",
      svcNet(d.consumerServiceId),
      svc(d.providerServiceId)?.name ?? "",
      svcNet(d.providerServiceId),
      s.cds.find((c) => c.id === d.viaCdsId)?.name ?? "",
    ]),
  };
}
