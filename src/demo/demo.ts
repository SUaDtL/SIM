import type { Repository } from "../domain/repository";

/**
 * A fictional enterprise for demos, screenshots and tests (WORK-014): six internal networks and a
 * cloud SaaS zone, about a hundred services, three CDS and several providing organizations. Every
 * name is invented and every marking is UNCLASSIFIED, so the banner never shows a classification the
 * data does not have; the caveat says it is a demo. Built through the repository, so every
 * validation rule applies, and deterministic, so each build is identical.
 */
export const DEMO_NAME = "Demo enterprise (fictional)";
export const DEMO_CAVEAT = "DEMO - FICTIONAL DATA";

interface NetworkPlan {
  readonly name: string;
  readonly description: string;
  /** Services beyond the common set, and how many of the common set to skip from the end. */
  readonly extra: readonly string[];
  readonly skip: number;
}

const NETWORKS: readonly NetworkPlan[] = [
  { name: "Enterprise", description: "Day-to-day business network.", extra: ["Print", "Intranet", "Travel"], skip: 0 },
  {
    name: "Operations",
    description: "Operations planning and control.",
    extra: ["Common Picture", "Planning"],
    skip: 0,
  },
  {
    name: "Mission Partner",
    description: "Shared with partner organizations.",
    extra: ["Partner Portal", "Translation"],
    skip: 2,
  },
  { name: "Research", description: "Isolated research and analysis.", extra: ["Analytics", "Data Lake"], skip: 1 },
  { name: "Test and Dev", description: "Development and testing.", extra: ["Build", "Code Review"], skip: 3 },
  { name: "Training", description: "Classroom and exercise network.", extra: ["Learning", "Simulation"], skip: 4 },
];

const COMMON = [
  "Identity",
  "DNS",
  "Email",
  "Chat",
  "File Share",
  "Patching",
  "Wiki",
  "Tickets",
  "Backup",
  "Logging",
  "Monitoring",
  "Calendar",
  "Video",
  "Maps",
] as const;

const CLOUD = ["Office Suite", "CRM", "Service Desk", "Video Meetings", "Code Hosting"] as const;

const CATEGORY_OF: Record<string, string> = {
  Identity: "Infrastructure",
  DNS: "Infrastructure",
  Backup: "Infrastructure",
  Patching: "Cyber",
  Logging: "Cyber",
  Monitoring: "Cyber",
  "Common Picture": "Operations",
  Planning: "Operations",
  Maps: "Operations",
};

export function populateDemo(repo: Repository): void {
  const it = repo.createOrganization({ name: "IT Directorate" });
  const ops = repo.createOrganization({ name: "Operations Support" });
  const cyber = repo.createOrganization({ name: "Cyber Team", parentId: it.id });
  const desk = repo.createOrganization({ name: "Help Desk", parentId: it.id });
  const vendor = repo.createOrganization({ name: "Contractor A" });
  const users = ["Planners", "Analysts", "Engineers"].map((name) => repo.createOrganization({ name }));
  const categories = new Map(
    ["Collaboration", "Infrastructure", "Cyber", "Operations"].map((name) => [name, repo.createCategory({ name })]),
  );
  const exchange = repo.createApplication({ name: "Mail Platform", vendor: "Example Vendor One" });
  const messenger = repo.createApplication({ name: "Team Messenger", vendor: "Example Vendor Two" });

  const nets = NETWORKS.map((plan) =>
    repo.createNetwork({ name: plan.name, kind: "internal", marking: "UNCLASSIFIED", description: plan.description }),
  );
  const cloudNet = repo.createNetwork({
    name: "Cloud SaaS",
    kind: "external",
    marking: "UNCLASSIFIED",
    description: "Commercial cloud services.",
  });

  // Services per network. Operations runs its own Chat (provided by Operations Support, not IT):
  // the duplicated-provider case the map is meant to expose (decomposition Q-012).
  const services = NETWORKS.map((plan, i) => {
    const net = nets[i];
    if (!net) throw new Error("demo network missing");
    const ids = new Map<string, number>();
    for (const name of [...COMMON.slice(0, COMMON.length - plan.skip), ...plan.extra]) {
      const provider = plan.name === "Operations" && (name === "Chat" || name === "Planning") ? ops : it;
      const category = categories.get(CATEGORY_OF[name] ?? "Collaboration");
      const service = repo.createService({
        name,
        networkId: net.id,
        marking: "UNCLASSIFIED",
        foundational: name === "Identity" || name === "DNS",
        providerOrgId: name === "Logging" || name === "Monitoring" ? cyber.id : provider.id,
        categoryId: category?.id ?? null,
        applicationId: name === "Email" ? exchange.id : name === "Chat" ? messenger.id : null,
      });
      ids.set(name, service.id);
      if (name === "Tickets" || name === "Email") repo.setSupport(service.id, 1, desk.id);
      if (name === "Patching") repo.setSupport(service.id, 2, cyber.id);
      if (name === "Backup") repo.setSupport(service.id, 3, vendor.id);
    }
    return ids;
  });
  const cloud = new Map(
    CLOUD.map((name) => [
      name,
      repo.createService({ name, networkId: cloudNet.id, marking: "UNCLASSIFIED", providerOrgId: vendor.id }).id,
    ]),
  );

  const net = (i: number) => {
    const n = nets[i];
    if (!n) throw new Error("demo network missing");
    return n.id;
  };
  const guard = repo.createCds({ name: "Enterprise-Ops guard", networkIds: [net(0), net(1)] });
  const partner = repo.createCds({ name: "Partner gateway", networkIds: [net(1), net(2), net(5)] });
  const research = repo.createCds({ name: "Research guard", networkIds: [net(1), net(3)] });

  const svc = (i: number, name: string) => services[i]?.get(name);
  const link = (consumer: number | undefined, provider: number | undefined, viaCdsId?: number) => {
    if (consumer === undefined || provider === undefined) return;
    repo.addDependency({ consumerServiceId: consumer, providerServiceId: provider, viaCdsId: viaCdsId ?? null });
  };

  // Inside every network: identity and name resolution, plus a few local chains.
  services.forEach((ids, i) => {
    for (const name of ["Email", "Chat", "File Share", "Wiki", "Tickets", "Calendar", "Video", "Maps"]) {
      link(ids.get(name), ids.get("Identity"));
      link(ids.get(name), ids.get("DNS"));
    }
    link(ids.get("Monitoring"), ids.get("Logging"));
    link(ids.get("Backup"), ids.get("File Share"));
    link(ids.get("Calendar"), ids.get("Email"));
    link(svc(i, "Common Picture"), svc(i, "Maps"));
    link(svc(i, "Planning"), svc(i, "Common Picture"));
    link(svc(i, "Code Review"), svc(i, "Build"));
    link(svc(i, "Data Lake"), svc(i, "Backup"));
    link(svc(i, "Analytics"), svc(i, "Data Lake"));
  });

  // Across networks through a CDS.
  link(svc(1, "Patching"), svc(0, "Patching"), guard.id);
  link(svc(1, "Email"), svc(0, "Email"), guard.id);
  link(svc(2, "Chat"), svc(1, "Chat"), partner.id);
  link(svc(2, "Partner Portal"), svc(1, "Common Picture"), partner.id);
  link(svc(5, "Learning"), svc(1, "Planning"), partner.id);
  link(svc(3, "Analytics"), svc(1, "Common Picture"), research.id);
  link(svc(3, "Patching"), svc(1, "Patching"), research.id);

  // Across networks with no CDS: the risks the map should make visible.
  link(svc(4, "Backup"), svc(0, "Backup"));
  link(svc(5, "Email"), svc(0, "Email"));

  // Out to the cloud.
  link(svc(0, "Email"), cloud.get("Office Suite"));
  link(svc(0, "Tickets"), cloud.get("Service Desk"));
  link(svc(0, "Video"), cloud.get("Video Meetings"));
  link(svc(4, "Build"), cloud.get("Code Hosting"));
  link(svc(2, "Partner Portal"), cloud.get("CRM"));

  // Who uses what.
  const [planners, analysts, engineers] = users;
  for (const name of ["Common Picture", "Planning", "Maps"]) {
    const id = svc(1, name);
    if (planners && id !== undefined) repo.addConsumption(planners.id, id);
  }
  for (const name of ["Analytics", "Data Lake"]) {
    const id = svc(3, name);
    if (analysts && id !== undefined) repo.addConsumption(analysts.id, id);
  }
  for (const name of ["Build", "Code Review"]) {
    const id = svc(4, name);
    if (engineers && id !== undefined) repo.addConsumption(engineers.id, id);
  }

  repo.setCaveat(DEMO_CAVEAT);
}
