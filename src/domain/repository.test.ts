import { beforeEach, describe, expect, it } from "vitest";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset } from "../db/dataset";
import { SensitiveInputWarning, ValidationError } from "./errors";
import { Repository } from "./repository";

let repo: Repository;

beforeEach(async () => {
  repo = new Repository(await createDataset("Test", wasm));
});

async function codeOf(action: () => unknown): Promise<string> {
  try {
    await action();
    return "ok";
  } catch (error) {
    if (error instanceof ValidationError) return `${error.code}:${error.field}`;
    if (error instanceof SensitiveInputWarning) return "SENSITIVE";
    throw error;
  }
}

function seed() {
  const nipr = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  const sipr = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "SECRET" });
  const saas = repo.createNetwork({ name: "External", kind: "external", marking: "UNCLASSIFIED" });
  const j6 = repo.createOrganization({ name: "J6" });
  const desk = repo.createOrganization({ name: "J6 Service Desk", parentId: j6.id });
  const cyber = repo.createCategory({ name: "Cyber", color: "#e0624f" });
  const exchange = repo.createApplication({ name: "Exchange", vendor: "Microsoft" });
  const mail = repo.createService({
    name: "Email",
    networkId: nipr.id,
    marking: "CUI",
    applicationId: exchange.id,
    providerOrgId: j6.id,
  });
  const idam = repo.createService({ name: "Identity", networkId: nipr.id, marking: "CUI", foundational: true });
  const patch = repo.createService({ name: "Patching", networkId: sipr.id, marking: "SECRET", categoryId: cyber.id });
  const npatch = repo.createService({ name: "Patching", networkId: nipr.id, marking: "CUI", categoryId: cyber.id });
  const m365 = repo.createService({ name: "Office 365", networkId: saas.id, marking: "UNCLASSIFIED" });
  const cds = repo.createCds({ name: "NIPR-SIPR guard", networkIds: [nipr.id, sipr.id] });
  return { nipr, sipr, saas, j6, desk, cyber, exchange, mail, idam, patch, npatch, m365, cds };
}

describe("entity CRUD", () => {
  it("round-trips every entity type", () => {
    const s = seed();
    expect(repo.getNetwork(s.nipr.id)).toEqual({
      id: s.nipr.id,
      name: "NIPR",
      kind: "internal",
      marking: "CUI",
      description: null,
    });
    expect(repo.getOrganization(s.desk.id)?.parentId).toBe(s.j6.id);
    expect(repo.getCategory(s.cyber.id)?.color).toBe("#e0624f");
    expect(repo.getApplication(s.exchange.id)?.vendor).toBe("Microsoft");
    expect(repo.getService(s.mail.id)).toMatchObject({
      name: "Email",
      networkId: s.nipr.id,
      applicationId: s.exchange.id,
      providerOrgId: s.j6.id,
      categoryId: null,
      foundational: false,
    });
    expect(repo.getService(s.idam.id)?.foundational).toBe(true);
    expect(repo.getCds(s.cds.id)?.networkIds).toEqual([s.nipr.id, s.sipr.id]);
    expect(repo.listNetworks().map((n) => n.name)).toEqual(["External", "NIPR", "SIPR"]);
    expect(repo.listServices()).toHaveLength(5);
  });

  it("updates every field it is given", () => {
    const s = seed();
    repo.updateService(s.mail.id, {
      name: "Mail",
      networkId: s.sipr.id,
      marking: "SECRET",
      description: "Secure mail",
      providerOrgId: s.desk.id,
      foundational: true,
    });
    expect(repo.getService(s.mail.id)).toMatchObject({
      name: "Mail",
      networkId: s.sipr.id,
      marking: "SECRET",
      description: "Secure mail",
      providerOrgId: s.desk.id,
      foundational: true,
    });
    repo.updateNetwork(s.saas.id, { name: "SaaS", kind: "external", marking: "CUI", description: "Vendors" });
    expect(repo.getNetwork(s.saas.id)).toMatchObject({ name: "SaaS", marking: "CUI", description: "Vendors" });
    repo.updateCds(s.cds.id, { name: "Guard", networkIds: [s.sipr.id, s.saas.id] });
    expect(repo.getCds(s.cds.id)?.networkIds).toEqual([s.sipr.id, s.saas.id]);
  });

  it("deletes entities", () => {
    const s = seed();
    repo.deleteService(s.m365.id);
    repo.deleteNetwork(s.saas.id);
    repo.deleteCds(s.cds.id);
    repo.deleteOrganization(s.desk.id);
    expect(repo.getNetwork(s.saas.id)).toBeUndefined();
    expect(repo.listCds()).toEqual([]);
    expect(repo.listOrganizations().map((o) => o.name)).toEqual(["J6"]);
  });

  it("manages support tiers, consumption and dependencies", () => {
    const s = seed();
    repo.setSupport(s.mail.id, 1, s.desk.id, "24x7 desk");
    repo.setSupport(s.mail.id, 2, s.j6.id);
    repo.setSupport(s.mail.id, 1, s.j6.id);
    expect(repo.listSupport(s.mail.id)).toEqual([
      { serviceId: s.mail.id, tier: 1, orgId: s.j6.id, notes: null },
      { serviceId: s.mail.id, tier: 2, orgId: s.j6.id, notes: null },
    ]);
    repo.setSupport(s.mail.id, 2, null);
    expect(repo.listSupport(s.mail.id)).toHaveLength(1);

    repo.addConsumption(s.desk.id, s.mail.id);
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.idam.id });
    repo.addDependency({ consumerServiceId: s.patch.id, providerServiceId: s.npatch.id, viaCdsId: s.cds.id });
    expect(repo.listConsumption()).toEqual([{ orgId: s.desk.id, serviceId: s.mail.id }]);
    expect(repo.listDependencies()).toHaveLength(2);
    repo.removeDependency(s.mail.id, s.idam.id);
    repo.removeConsumption(s.desk.id, s.mail.id);
    expect(repo.listDependencies()).toHaveLength(1);
    expect(repo.listConsumption()).toEqual([]);
  });
});

describe("validation", () => {
  it.each([
    ["blank name", () => repo.createNetwork({ name: " ", kind: "internal", marking: "CUI" }), "REQUIRED:network name"],
    [
      "duplicate name (case-insensitive)",
      () => repo.createNetwork({ name: "nipr", kind: "internal", marking: "CUI" }),
      "DUPLICATE:network name",
    ],
    [
      "invalid marking",
      () => repo.createNetwork({ name: "X", kind: "internal", marking: "SECRETISH" as never }),
      "INVALID_VALUE:marking",
    ],
    [
      "invalid kind",
      () => repo.createNetwork({ name: "X", kind: "cloud" as never, marking: "CUI" }),
      "INVALID_VALUE:kind",
    ],
    ["unknown network", () => repo.createService({ name: "X", networkId: 999, marking: "CUI" }), "NOT_FOUND:network"],
    ["CDS with one network", () => repo.createCds({ name: "Lonely", networkIds: [1] }), "CDS_NETWORKS:networks"],
  ])("refuses %s", async (_name, action, expected) => {
    seed();
    expect(await codeOf(action)).toBe(expected);
  });

  it("refuses deleting a network that still has services, without changing anything", async () => {
    const s = seed();
    expect(
      await codeOf(() => {
        repo.deleteNetwork(s.nipr.id);
      }),
    ).toBe("IN_USE:network");
    expect(repo.listNetworks()).toHaveLength(3);
  });

  it("refuses organization parent cycles", async () => {
    const s = seed();
    const team = repo.createOrganization({ name: "Team", parentId: s.desk.id });
    expect(await codeOf(() => repo.updateOrganization(s.j6.id, { name: "J6", parentId: team.id }))).toBe(
      "CYCLE:parent",
    );
    expect(await codeOf(() => repo.updateOrganization(s.j6.id, { name: "J6", parentId: s.j6.id }))).toBe(
      "CYCLE:parent",
    );
    expect(repo.getOrganization(s.j6.id)?.parentId).toBeNull();
  });

  it("refuses self and duplicate dependencies", async () => {
    const s = seed();
    expect(
      await codeOf(() => {
        repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.mail.id });
      }),
    ).toBe("SELF_LINK:provider");
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.idam.id });
    expect(
      await codeOf(() => {
        repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.idam.id });
      }),
    ).toBe("DUPLICATE:dependency");
  });

  it("requires a CDS route to join two different networks that the CDS connects", async () => {
    const s = seed();
    // same network
    expect(
      await codeOf(() => {
        repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.idam.id, viaCdsId: s.cds.id });
      }),
    ).toBe("CDS_ROUTE:via");
    // CDS does not join External
    expect(
      await codeOf(() => {
        repo.addDependency({ consumerServiceId: s.patch.id, providerServiceId: s.m365.id, viaCdsId: s.cds.id });
      }),
    ).toBe("CDS_ROUTE:via");
    expect(repo.listDependencies()).toEqual([]);
  });

  describe("keeps existing CDS routes valid", () => {
    function routed() {
      const s = seed();
      // Mail (NIPR) depends on Patching (SIPR) through the NIPR-SIPR guard.
      repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.patch.id, viaCdsId: s.cds.id });
      return s;
    }

    it("refuses a CDS edit that drops a network one of its routes uses", async () => {
      const s = routed();
      expect(
        await codeOf(() => repo.updateCds(s.cds.id, { name: "NIPR-SIPR guard", networkIds: [s.nipr.id, s.saas.id] })),
      ).toBe("CDS_ROUTE:networks");
      expect(repo.getCds(s.cds.id)?.networkIds).toEqual([s.nipr.id, s.sipr.id]);
    });

    it("refuses moving a service so its CDS route no longer crosses two joined networks", async () => {
      const s = routed();
      const move = (networkId: number) => () =>
        repo.updateService(s.patch.id, { name: "Patching 2", networkId, marking: "SECRET" });
      expect(await codeOf(move(s.nipr.id))).toBe("CDS_ROUTE:network"); // same network as Mail
      expect(await codeOf(move(s.saas.id))).toBe("CDS_ROUTE:network"); // the CDS does not join External
      expect(repo.getService(s.patch.id)?.networkId).toBe(s.sipr.id);
    });

    it("refuses deleting a network that a CDS joins", async () => {
      const s = seed();
      const lab = repo.createNetwork({ name: "Lab", kind: "internal", marking: "UNCLASSIFIED" });
      repo.updateCds(s.cds.id, { name: "NIPR-SIPR guard", networkIds: [s.nipr.id, s.sipr.id, lab.id] });
      expect(
        await codeOf(() => {
          repo.deleteNetwork(lab.id);
        }),
      ).toBe("IN_USE:network");
      expect(repo.getCds(s.cds.id)?.networkIds).toEqual([s.nipr.id, s.sipr.id, lab.id]);
    });

    it("still allows edits that keep routes valid", () => {
      const s = routed();
      repo.updateCds(s.cds.id, { name: "Guard", networkIds: [s.nipr.id, s.sipr.id, s.saas.id] });
      repo.updateService(s.patch.id, { name: "Patching 2", networkId: s.sipr.id, marking: "SECRET" });
      expect(repo.listDependencies()).toHaveLength(1);
    });
  });

  it("allows a cross-network dependency without a CDS (shown as a direct crossing on the map)", () => {
    const s = seed();
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.m365.id });
    expect(repo.listDependencies()).toHaveLength(1);
  });
});

describe("sensitive input", () => {
  it("warns about host-like text and writes nothing until confirmed", () => {
    const s = seed();
    const input = {
      name: "mail.j6.example.mil",
      networkId: s.nipr.id,
      marking: "CUI" as const,
      description: "relay 10.2.3.4",
    };
    let warning: unknown;
    try {
      repo.createService(input);
    } catch (error) {
      warning = error;
    }
    expect(warning).toBeInstanceOf(SensitiveInputWarning);
    expect((warning as SensitiveInputWarning).findings.map((f) => f.field)).toEqual(["service name", "description"]);
    expect(repo.listServices()).toHaveLength(5);

    repo.createService(input, { confirmSensitive: true });
    expect(repo.listServices()).toHaveLength(6);
  });

  it("checks every free-text field", async () => {
    const s = seed();
    expect(await codeOf(() => repo.createApplication({ name: "App", vendor: "vendor.example.com" }))).toBe("SENSITIVE");
    expect(
      await codeOf(() => {
        repo.setSupport(s.mail.id, 3, s.j6.id, "call 192.168.1.1");
      }),
    ).toBe("SENSITIVE");
    expect(await codeOf(() => repo.createOrganization({ name: "ops.example.mil" }))).toBe("SENSITIVE");
  });

  it("does not flag ordinary product names", () => {
    const s = seed();
    expect(() =>
      repo.createService({ name: "Microsoft 365", networkId: s.saas.id, marking: "UNCLASSIFIED" }),
    ).not.toThrow();
  });
});

describe("classification and snapshot", () => {
  it("derives the dataset and CDS markings", () => {
    const s = seed();
    expect(repo.datasetMarking()).toBe("SECRET");
    expect(repo.snapshot().cds[0]?.marking).toBe("SECRET");
    repo.updateService(s.m365.id, { name: "Office 365", networkId: s.saas.id, marking: "TOP SECRET" });
    expect(repo.datasetMarking()).toBe("TOP SECRET");
  });

  it("returns UNCLASSIFIED for an empty dataset", () => {
    expect(repo.datasetMarking()).toBe("UNCLASSIFIED");
  });

  it("includes every entity and link in the snapshot", () => {
    const s = seed();
    repo.addConsumption(s.desk.id, s.mail.id);
    repo.addDependency({ consumerServiceId: s.patch.id, providerServiceId: s.npatch.id, viaCdsId: s.cds.id });
    repo.setSupport(s.mail.id, 1, s.desk.id);
    const snap = repo.snapshot();
    expect({
      networks: snap.networks.length,
      services: snap.services.length,
      cds: snap.cds.length,
      organizations: snap.organizations.length,
      applications: snap.applications.length,
      categories: snap.categories.length,
      dependencies: snap.dependencies.length,
      consumption: snap.consumption.length,
      support: snap.support.length,
      marking: snap.marking,
    }).toEqual({
      networks: 3,
      services: 5,
      cds: 1,
      organizations: 2,
      applications: 1,
      categories: 1,
      dependencies: 1,
      consumption: 1,
      support: 1,
      marking: "SECRET",
    });
  });
});

describe("change events", () => {
  it("notifies once per successful write and not for refused writes", async () => {
    let calls = 0;
    const unsubscribe = repo.subscribe(() => {
      calls++;
    });
    repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    expect(calls).toBe(1);
    await codeOf(() => repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" }));
    await codeOf(() => repo.createNetwork({ name: "10.0.0.1", kind: "internal", marking: "CUI" }));
    expect(calls).toBe(1);
    unsubscribe();
    repo.createNetwork({ name: "SIPR", kind: "internal", marking: "SECRET" });
    expect(calls).toBe(1);
  });
});
