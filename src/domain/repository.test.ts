import { beforeEach, describe, expect, it } from "vitest";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset, exportDataset, openDataset } from "../db/dataset";
import { SensitiveInputWarning, ValidationError } from "./errors";
import { MAX_UNDO_STEPS, Repository } from "./repository";

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
  it("preserves untouched legacy fields across ordinary entity updates", () => {
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
    const organization = repo.createOrganization({ name: "Ops" });
    const category = repo.createCategory({ name: "Tools", color: "#abcdef" });
    const application = repo.createApplication({ name: "Console" });
    const service = repo.createService({ name: "Queue", networkId: network.id, marking: "CUI" });
    const scenario = repo.createScenario({ name: "Plan" });
    const db = (repo as unknown as { db: import("sql.js").Database }).db;
    const longName = `  ${"N".repeat(205)}  `;
    db.run("UPDATE network SET name = ?, description = ? WHERE id = ?", [longName, "  old network text  ", network.id]);
    db.run("UPDATE organization SET name = ? WHERE id = ?", [longName, organization.id]);
    db.run("UPDATE category SET color = ? WHERE id = ?", ["legacy-color", category.id]);
    db.run("UPDATE application SET vendor = ? WHERE id = ?", ["  old vendor  ", application.id]);
    db.run("UPDATE service SET name = ? WHERE id = ?", [longName, service.id]);
    db.run("UPDATE scenario SET description = ? WHERE id = ?", ["  old plan text  ", scenario.id]);

    repo.updateNetwork(network.id, {
      name: longName,
      kind: "external",
      marking: "CUI",
      description: "  old network text  ",
    });
    repo.updateOrganization(organization.id, { name: longName, parentId: null });
    repo.updateCategory(category.id, { name: "Updated Tools", color: "legacy-color" });
    repo.updateApplication(application.id, { name: "Updated Console", vendor: "  old vendor  " });
    repo.updateService(service.id, { name: longName, networkId: network.id, marking: "CUI", foundational: true });
    repo.updateScenario(scenario.id, { name: "Updated Plan", description: "  old plan text  " });

    expect(repo.getNetwork(network.id)).toMatchObject({
      name: longName,
      description: "  old network text  ",
      kind: "external",
    });
    expect(repo.getOrganization(organization.id)?.name).toBe(longName);
    expect(repo.getCategory(category.id)).toMatchObject({ name: "Updated Tools", color: "legacy-color" });
    expect(repo.getApplication(application.id)).toMatchObject({ name: "Updated Console", vendor: "  old vendor  " });
    expect(repo.getService(service.id)).toMatchObject({ name: longName, foundational: true });
    expect(repo.getScenario(scenario.id)).toMatchObject({ name: "Updated Plan", description: "  old plan text  " });
  });

  it("allows unrelated organization and CDS edits while preserving legacy issues", async () => {
    const first = repo.createNetwork({ name: "First", kind: "internal", marking: "CUI" });
    const second = repo.createNetwork({ name: "Second", kind: "internal", marking: "CUI" });
    const a = repo.createOrganization({ name: "A" });
    const b = repo.createOrganization({ name: "B", parentId: a.id });
    const cds = repo.createCds({ name: "Bridge", networkIds: [first.id, second.id] });
    const db = (repo as unknown as { db: import("sql.js").Database }).db;
    db.run("UPDATE organization SET parent_id = ? WHERE id = ?", [b.id, a.id]);
    db.run("DELETE FROM cds_network WHERE cds_id = ? AND network_id = ?", [cds.id, second.id]);
    const longName = `  ${"B".repeat(205)}  `;
    db.run("UPDATE cds SET name = ?, description = ? WHERE id = ?", [longName, "  old bridge text  ", cds.id]);

    repo.updateOrganization(a.id, { name: "A renamed", parentId: b.id });
    repo.updateCds(cds.id, { name: longName, networkIds: [first.id], description: "  old bridge text  " });
    expect(repo.getOrganization(a.id)).toMatchObject({ name: "A renamed", parentId: b.id });
    expect(repo.getCds(cds.id)).toMatchObject({
      name: longName,
      description: "  old bridge text  ",
      networkIds: [first.id],
    });
    expect(await codeOf(() => repo.updateOrganization(a.id, { name: "A renamed", parentId: a.id }))).toBe(
      "CYCLE:parent",
    );
    expect(
      await codeOf(() =>
        repo.updateCds(cds.id, { name: longName, networkIds: [], description: "  old bridge text  " }),
      ),
    ).toBe("CDS_NETWORKS:networks");
  });

  it("keeps untouched legacy service text byte-for-byte during a relationship edit", () => {
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
    const org = repo.createOrganization({ name: "Ops" });
    const service = repo.createService({ name: "Legacy", networkId: network.id, marking: "CUI" });
    const db = (repo as unknown as { db: import("sql.js").Database }).db;
    const legacyName = `  ${"L".repeat(205)}  `;
    const legacyDescription = "  Existing text  ";
    db.run("UPDATE service SET name = ?, description = ? WHERE id = ?", [legacyName, legacyDescription, service.id]);
    const base = repo.readServiceEditBase(service.id);
    const result = repo.applyServiceDraft(service.id, base, {
      fields: { name: legacyName, networkId: network.id, marking: "CUI", description: legacyDescription },
      support: [],
      consumerOrgIds: [org.id],
      dependencies: [],
    });
    expect(result.status).toBe("committed");
    expect(repo.getService(service.id)).toMatchObject({ name: legacyName, description: legacyDescription });
  });
  it("refuses a final projected name collision across two rehomes", async () => {
    const a = repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
    const b = repo.createNetwork({ name: "Blue", kind: "internal", marking: "CUI" });
    const c = repo.createNetwork({ name: "Cedar", kind: "internal", marking: "CUI" });
    const first = repo.createService({ name: "Mail", networkId: a.id, marking: "CUI" });
    const second = repo.createService({ name: "Mail", networkId: b.id, marking: "CUI" });
    const plan = repo.createScenario({ name: "Move" });
    repo.addScenarioChange(plan.id, { kind: "rehome", serviceId: first.id, networkId: c.id });
    expect(
      await codeOf(() => repo.addScenarioChange(plan.id, { kind: "rehome", serviceId: second.id, networkId: c.id })),
    ).toBe("DUPLICATE:network");
    expect(repo.listScenarioChanges(plan.id)).toHaveLength(1);
  });

  it("allows a planned replacement after retiring its baseline name", () => {
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
    const service = repo.createService({ name: "Mail", networkId: network.id, marking: "CUI" });
    const plan = repo.createScenario({ name: "Replace" });
    repo.addScenarioChange(plan.id, { kind: "retire", serviceId: service.id });
    expect(
      repo.addScenarioChange(plan.id, { kind: "add", name: "Mail", networkId: network.id, marking: "CUI" }).kind,
    ).toBe("add");
  });

  it("uses SQLite ASCII-only NOCASE for projected identity", () => {
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
    const plan = repo.createScenario({ name: "Unicode" });
    repo.addScenarioChange(plan.id, { kind: "add", name: "Ä", networkId: network.id, marking: "CUI" });
    expect(
      repo.addScenarioChange(plan.id, { kind: "add", name: "ä", networkId: network.id, marking: "CUI" }).kind,
    ).toBe("add");
    expect(repo.scenarioNameCollisions(plan.id)).toEqual([]);
  });

  it("diagnoses baseline drift and permits incremental scenario repair", () => {
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
    const plan = repo.createScenario({ name: "Future" });
    const planned = repo.addScenarioChange(plan.id, {
      kind: "add",
      name: "Mail",
      networkId: network.id,
      marking: "CUI",
    });
    repo.createService({ name: "Mail", networkId: network.id, marking: "CUI" });
    expect(repo.scenarioNameCollisions(plan.id)).toMatchObject([{ networkId: network.id }]);
    expect(repo.createCategory({ name: "Unrelated" }).name).toBe("Unrelated");
    repo.removeScenarioChange(planned.id);
    expect(repo.scenarioNameCollisions(plan.id)).toEqual([]);
  });
  it("lets a service edit proceed when an unrelated legacy route is already invalid", async () => {
    const db = await createDataset("Legacy", wasm);
    const current = new Repository(db);
    const a = current.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
    const b = current.createNetwork({ name: "Blue", kind: "internal", marking: "CUI" });
    const c = current.createNetwork({ name: "Cedar", kind: "internal", marking: "CUI" });
    const source = current.createService({ name: "Source", networkId: a.id, marking: "CUI" });
    const target = current.createService({ name: "Target", networkId: b.id, marking: "CUI" });
    const other = current.createService({ name: "Other", networkId: c.id, marking: "CUI" });
    const cds = current.createCds({ name: "Guard", networkIds: [a.id, b.id] });
    current.addDependency({ consumerServiceId: source.id, providerServiceId: target.id, viaCdsId: cds.id });
    db.run("DELETE FROM cds_network WHERE cds_id = ? AND network_id = ?", [cds.id, b.id]);
    const base = current.readServiceEditBase(other.id);
    const result = current.applyServiceDraft(other.id, base, {
      fields: { name: "Other renamed", networkId: c.id, marking: "CUI" },
      support: [],
      consumerOrgIds: [],
      dependencies: [],
    });
    expect(result.status).toBe("committed");
    expect(current.getService(other.id)?.name).toBe("Other renamed");
    db.close();
  });
  it("lets legacy route owners change unrelated fields but blocks a worsened route", async () => {
    const a = repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
    const b = repo.createNetwork({ name: "Blue", kind: "internal", marking: "CUI" });
    const source = repo.createService({ name: "Source", networkId: a.id, marking: "CUI" });
    const target = repo.createService({ name: "Target", networkId: b.id, marking: "CUI" });
    const cds = repo.createCds({ name: "Guard", networkIds: [a.id, b.id] });
    repo.addDependency({ consumerServiceId: source.id, providerServiceId: target.id, viaCdsId: cds.id });
    const db = (repo as unknown as { db: import("sql.js").Database }).db;
    db.run("DELETE FROM cds_network WHERE cds_id = ? AND network_id = ?", [cds.id, b.id]);

    repo.updateService(source.id, { name: "Source renamed", networkId: a.id, marking: "CUI" });
    repo.updateCds(cds.id, { name: "Guard renamed", networkIds: [a.id] });
    expect(repo.getService(source.id)?.name).toBe("Source renamed");
    expect(repo.getCds(cds.id)?.name).toBe("Guard renamed");
    expect(await codeOf(() => repo.updateService(target.id, { name: "Target", networkId: a.id, marking: "CUI" }))).toBe(
      "CDS_ROUTE:network",
    );
  });
  it("does not re-prompt stored sensitive text during an unrelated service edit", () => {
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
    const org = repo.createOrganization({ name: "Ops" });
    const service = repo.createService(
      { name: "mail.example.test", networkId: network.id, marking: "CUI" },
      { confirmSensitive: true },
    );
    repo.setSupport(service.id, 1, org.id, "already.example.test", { confirmSensitive: true });
    const base = repo.readServiceEditBase(service.id);
    const result = repo.applyServiceDraft(service.id, base, {
      fields: { name: service.name, networkId: network.id, marking: "CUI" },
      support: base.support,
      consumerOrgIds: [org.id],
      dependencies: [],
    });
    expect(result.status).toBe("committed");
    expect(repo.listSupport(service.id)[0]?.notes).toBe("already.example.test");
  });
  it("describes delete effects and refuses a stale consequence confirmation", async () => {
    const s = seed();
    repo.addConsumption(s.j6.id, s.mail.id);
    repo.setSupport(s.mail.id, 1, s.j6.id);
    const plan = repo.planDelete("service", s.mail.id);
    expect(plan.details.join(" ")).toContain("consumer");
    expect(plan.details.join(" ")).toContain("support");
    repo.addConsumption(s.desk.id, s.mail.id);
    expect(
      await codeOf(() => {
        repo.deleteWithPlan("service", s.mail.id, plan.signature);
      }),
    ).toBe("STALE:delete");
    expect(repo.getService(s.mail.id)).toBeDefined();
    const refreshed = repo.planDelete("service", s.mail.id);
    repo.deleteWithPlan("service", s.mail.id, refreshed.signature);
    expect(repo.getService(s.mail.id)).toBeUndefined();
    expect(repo.undo()).toBe(true);
    expect(repo.getService(s.mail.id)).toBeDefined();
  });
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

describe("map positions", () => {
  it("saves positions in one write, rounded, and lists them in the snapshot", () => {
    const s = seed();
    let calls = 0;
    repo.subscribe(() => {
      calls++;
    });
    repo.setPositions([
      { entity: "network", id: s.nipr.id, x: 10.04, y: -20 },
      { entity: "service", id: s.mail.id, x: 1.26, y: 2 },
      { entity: "cds", id: s.cds.id, x: 0, y: 0 },
    ]);
    expect(calls).toBe(1);
    expect(repo.snapshot().positions).toEqual([
      { entity: "network", id: s.nipr.id, x: 10, y: -20 },
      { entity: "service", id: s.mail.id, x: 1.3, y: 2 },
      { entity: "cds", id: s.cds.id, x: 0, y: 0 },
    ]);
  });

  it("writes nothing and notifies nobody when no position changed", () => {
    const s = seed();
    repo.setPositions([{ entity: "service", id: s.mail.id, x: 5, y: 5 }]);
    let calls = 0;
    repo.subscribe(() => {
      calls++;
    });
    repo.setPositions([{ entity: "service", id: s.mail.id, x: 5.01, y: 4.99 }]);
    repo.setPositions([]);
    expect(calls).toBe(0);
  });

  it("refuses non-finite or out-of-range positions without changing anything", async () => {
    const s = seed();
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      expect(
        await codeOf(() => {
          repo.setPositions([
            { entity: "service", id: s.idam.id, x: 1, y: 1 },
            { entity: "service", id: s.mail.id, x, y: 0 },
          ]);
        }),
      ).toBe("INVALID_VALUE:position");
    }
    expect(repo.snapshot().positions).toEqual([]);
  });

  it("refuses a position for something that no longer exists", async () => {
    expect(
      await codeOf(() => {
        repo.setPositions([{ entity: "service", id: 999, x: 0, y: 0 }]);
      }),
    ).toBe("NOT_FOUND:service");
  });

  it("keeps positions when an entity is edited and drops them when it is deleted", () => {
    const s = seed();
    repo.setPositions([{ entity: "service", id: s.mail.id, x: 5, y: 5 }]);
    repo.updateService(s.mail.id, { name: "Mail", networkId: s.nipr.id, marking: "CUI" });
    expect(repo.snapshot().positions).toHaveLength(1);
    repo.deleteService(s.mail.id);
    expect(repo.snapshot().positions).toEqual([]);
  });
});

describe("banner caveat", () => {
  it("sets, normalizes, lists in the snapshot and clears the caveat, notifying each time", () => {
    let calls = 0;
    repo.subscribe(() => {
      calls++;
    });
    expect(repo.snapshot().caveat).toBeNull();
    repo.setCaveat("//rel to usa, fvey");
    expect(repo.snapshot().caveat).toBe("REL TO USA, FVEY");
    repo.setCaveat("REL TO USA, FVEY");
    repo.setCaveat("  ");
    repo.setCaveat(null);
    expect(repo.datasetCaveat()).toBeNull();
    expect(calls).toBe(2);
  });

  it("refuses a caveat outside the banner characters without changing anything", async () => {
    repo.setCaveat("NOFORN");
    expect(
      await codeOf(() => {
        repo.setCaveat("relay.example.mil");
      }),
    ).toBe("INVALID_VALUE:caveat");
    expect(repo.datasetCaveat()).toBe("NOFORN");
  });

  it("restores the previous caveat when a replacement is undone and redone", () => {
    repo.setCaveat("NOFORN");
    repo.setCaveat("REL TO USA");
    expect(repo.datasetCaveat()).toBe("REL TO USA");

    expect(repo.undo()).toBe(true);
    expect(repo.datasetCaveat()).toBe("NOFORN");
    expect(repo.redo()).toBe(true);
    expect(repo.datasetCaveat()).toBe("REL TO USA");
  });
});

describe("undo and redo", () => {
  const state = () => {
    const snap = repo.snapshot();
    return JSON.stringify({ ...snap, positions: snap.positions });
  };

  it("records a trigger for every insert, update and delete on every table", () => {
    const db = (repo as unknown as { db: { exec(sql: string): { values: unknown[][] }[] } }).db;
    const tables = (
      db.exec("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")[0]?.values ?? []
    ).map((r) => String(r[0]));
    const triggers = new Set(
      (db.exec("SELECT name FROM sqlite_temp_master WHERE type = 'trigger'")[0]?.values ?? []).map((r) => String(r[0])),
    );
    expect(tables.length).toBeGreaterThan(5);
    for (const t of tables) {
      for (const op of ["insert", "update", "delete"]) expect(triggers.has(`undo_${t}_${op}`), `${t} ${op}`).toBe(true);
    }
  });

  it("undoes and redoes each write as one step", () => {
    expect(repo.canUndo()).toBe(false);
    const empty = state();
    const nipr = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    const one = state();
    repo.updateNetwork(nipr.id, { name: "NIPR-1", kind: "internal", marking: "SECRET" });
    const two = state();
    let calls = 0;
    repo.subscribe(() => {
      calls++;
    });

    expect(repo.undo()).toBe(true);
    expect(state()).toBe(one);
    expect(repo.undo()).toBe(true);
    expect(state()).toBe(empty);
    expect(repo.canUndo()).toBe(false);
    expect(repo.undo()).toBe(false);
    expect(repo.redo()).toBe(true);
    expect(repo.redo()).toBe(true);
    expect(state()).toBe(two);
    expect(repo.canRedo()).toBe(false);
    expect(calls).toBe(4);
  });

  it("brings back everything a delete cascaded or cleared", () => {
    const s = seed();
    repo.addConsumption(s.desk.id, s.mail.id);
    repo.setSupport(s.mail.id, 1, s.desk.id);
    repo.addDependency({ consumerServiceId: s.patch.id, providerServiceId: s.npatch.id, viaCdsId: s.cds.id });
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.idam.id });
    const before = state();
    repo.deleteService(s.mail.id);
    repo.deleteCds(s.cds.id);
    repo.deleteOrganization(s.j6.id);
    expect(state()).not.toBe(before);
    repo.undo();
    repo.undo();
    repo.undo();
    expect(state()).toBe(before);
  });

  it("keeps a refused write out of the history", async () => {
    repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    await codeOf(() => repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" }));
    repo.undo();
    expect(repo.canUndo()).toBe(false);
  });

  it("drops the redo history on a new write, which may reuse an undone id", () => {
    const a = repo.createNetwork({ name: "A", kind: "internal", marking: "CUI" });
    repo.undo();
    const b = repo.createNetwork({ name: "B", kind: "internal", marking: "CUI" });
    expect(b.id).toBe(a.id);
    expect(repo.canRedo()).toBe(false);
    expect(repo.redo()).toBe(false);
    expect(repo.listNetworks().map((n) => n.name)).toEqual(["B"]);
  });

  it("merges a follow-up position write into the write before it, and leaves an opening layout out", () => {
    const n = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    repo.setPositions([{ entity: "network", id: n.id, x: 5, y: 5 }], "none");
    repo.undo();
    expect(repo.listNetworks()).toHaveLength(0);

    const s = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "SECRET" });
    repo.setPositions([{ entity: "network", id: s.id, x: 1, y: 1 }], "merge");
    repo.undo();
    expect(repo.listNetworks()).toHaveLength(0);
    expect(repo.canUndo()).toBe(false);
    repo.redo();
    expect(repo.snapshot().positions).toEqual([{ entity: "network", id: s.id, x: 1, y: 1 }]);

    // After an undo or redo there is nothing to merge into, so the write stands alone and redo survives.
    repo.setPositions([{ entity: "network", id: s.id, x: 2, y: 2 }]);
    repo.undo();
    repo.setPositions([{ entity: "network", id: s.id, x: 1, y: 1 }], "merge");
    expect(repo.canRedo()).toBe(true);
  });

  it("forgets the position of a service that moves to another network, in the same step", () => {
    const s = seed();
    repo.setPositions([{ entity: "service", id: s.mail.id, x: 5, y: 5 }]);
    repo.updateService(s.mail.id, { name: "Email", networkId: s.sipr.id, marking: "SECRET" });
    expect(repo.snapshot().positions).toEqual([]);
    repo.undo();
    expect(repo.snapshot().positions).toEqual([{ entity: "service", id: s.mail.id, x: 5, y: 5 }]);
    repo.updateService(s.mail.id, { name: "Mail", networkId: s.nipr.id, marking: "CUI" });
    expect(repo.snapshot().positions).toHaveLength(1);
  });

  it("keeps working after a save and leaves nothing of itself in the saved file", async () => {
    repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    const db = (repo as unknown as { db: { export(): Uint8Array } }).db;
    const bytes = exportDataset(db as never);
    const reopened = await openDataset(bytes, { wasm });
    expect(reopened.exec("SELECT name FROM sqlite_master WHERE name LIKE 'undo%'")).toEqual([]);
    expect(repo.undo()).toBe(true);
    expect(repo.listNetworks()).toHaveLength(0);
  });

  it("starts a fresh history when another repository opens the same database", () => {
    repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    const db = (repo as unknown as { db: ConstructorParameters<typeof Repository>[0] }).db;
    const again = new Repository(db);
    expect(again.canUndo()).toBe(false);
    again.createNetwork({ name: "SIPR", kind: "internal", marking: "SECRET" });
    expect(again.undo()).toBe(true);
    expect(again.listNetworks().map((n) => n.name)).toEqual(["NIPR"]);
  });

  it("caps the history", () => {
    const n = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    for (let i = 0; i < MAX_UNDO_STEPS + 5; i++) repo.setPositions([{ entity: "network", id: n.id, x: i + 1, y: 0 }]);
    let steps = 0;
    while (repo.undo()) steps++;
    expect(steps).toBe(MAX_UNDO_STEPS);
  });
});

describe("repository notifications", () => {
  it("keeps a committed write successful and notifies later subscribers when one throws", () => {
    const calls: string[] = [];
    const failures: unknown[][] = [];
    repo.subscribeProjectionFailures((errors) => {
      failures.push([...errors]);
    });
    repo.subscribe(() => {
      calls.push("first");
      throw new Error("synthetic view failure");
    });
    repo.subscribe(() => {
      calls.push("second");
    });

    const network = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    expect(repo.getNetwork(network.id)?.name).toBe("NIPR");
    expect(calls).toEqual(["first", "second"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.[0]).toEqual(new Error("synthetic view failure"));
  });

  it("keeps Undo successful when a view subscriber fails", () => {
    repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    const failures: unknown[][] = [];
    repo.subscribe(() => {
      throw new Error("synthetic Undo view failure");
    });
    repo.subscribeProjectionFailures((errors) => failures.push([...errors]));

    expect(repo.undo()).toBe(true);
    expect(repo.listNetworks()).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it("delivers reentrant writes after the current notification reaches every subscriber", () => {
    const seen: number[] = [];
    let nested = false;
    repo.subscribe(() => {
      if (!nested) {
        nested = true;
        repo.createNetwork({ name: "SIPR", kind: "internal", marking: "SECRET" });
      }
    });
    repo.subscribe((change) => {
      seen.push(change.revision);
    });

    repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    expect(seen).toEqual([1, 2]);
  });
});

describe("atomic commands", () => {
  it("rolls back all writes, inverse history and notifications when a command fails", () => {
    let notifications = 0;
    repo.subscribe(() => {
      notifications++;
    });

    expect(() =>
      repo.atomic(() => {
        repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
        throw new Error("synthetic command failure");
      }),
    ).toThrow("synthetic command failure");
    expect(repo.listNetworks()).toEqual([]);
    expect(repo.canUndo()).toBe(false);
    expect(notifications).toBe(0);
  });

  it("keeps an independently caught inner refusal out of the accepted command", () => {
    const first = repo.atomic(() => {
      const network = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
      expect(() => repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" })).toThrow();
      repo.createNetwork({ name: "SIPR", kind: "internal", marking: "SECRET" });
      return network;
    });
    expect(first.name).toBe("NIPR");
    expect(repo.listNetworks().map((network) => network.name)).toEqual(["NIPR", "SIPR"]);
    expect(repo.undo()).toBe(true);
    expect(repo.listNetworks()).toEqual([]);
  });

  it("rolls back data when preparing history fails before SQL commit", () => {
    const internal = repo as unknown as { record: (start: number, history: string) => boolean };
    internal.record = () => {
      throw new Error("synthetic history preparation failure");
    };

    expect(() => repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" })).toThrow(
      "synthetic history preparation failure",
    );
    expect(repo.listNetworks()).toEqual([]);
    expect(repo.canUndo()).toBe(false);
  });

  it("retains an Undo step when statement extraction fails before BEGIN", () => {
    repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    const internal = repo as unknown as {
      rows: (sql: string, params?: number[]) => Record<string, unknown>[];
    };
    const originalRows = internal.rows.bind(repo);
    internal.rows = (sql, params) => {
      if (sql.includes("SELECT sql FROM undo_log")) throw new Error("synthetic statement extraction failure");
      return originalRows(sql, params);
    };

    expect(() => repo.undo()).toThrow("synthetic statement extraction failure");
    expect(repo.listNetworks()).toHaveLength(1);
    expect(repo.canUndo()).toBe(true);
    internal.rows = originalRows;
    expect(repo.undo()).toBe(true);
    expect(repo.listNetworks()).toEqual([]);
  });

  it("nests group and atomic in either direction without leaking intermediate notifications", () => {
    let notifications = 0;
    repo.subscribe(() => {
      notifications++;
    });
    repo.group(() => {
      repo.createNetwork({ name: "A", kind: "internal", marking: "CUI" });
      repo.atomic(() => {
        repo.createNetwork({ name: "B", kind: "internal", marking: "CUI" });
      });
    });
    expect(notifications).toBe(1);
    expect(repo.undo()).toBe(true);
    expect(repo.listNetworks()).toEqual([]);

    notifications = 0;
    repo.atomic(() => {
      repo.group(() => {
        repo.createNetwork({ name: "C", kind: "internal", marking: "CUI" });
        expect(() => repo.createNetwork({ name: "C", kind: "internal", marking: "CUI" })).toThrow();
        repo.createNetwork({ name: "D", kind: "internal", marking: "CUI" });
      });
    });
    expect(notifications).toBe(1);
    expect(repo.listNetworks().map((network) => network.name)).toEqual(["C", "D"]);
    expect(repo.undo()).toBe(true);
    expect(repo.listNetworks()).toEqual([]);
  });

  it("rejects a thenable callback and rolls back its synchronous writes", () => {
    expect(() =>
      repo.atomic(() => {
        repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
        return { then: (): void => undefined };
      }),
    ).toThrow("An atomic command must be synchronous.");
    expect(repo.listNetworks()).toEqual([]);
    expect(repo.canUndo()).toBe(false);
  });
});

describe("legacy semantic repairs", () => {
  it("bounds parent validation when an admitted legacy hierarchy already contains a cycle", () => {
    const first = repo.createOrganization({ name: "First" });
    const second = repo.createOrganization({ name: "Second" });
    const third = repo.createOrganization({ name: "Third" });
    const detached = repo.createOrganization({ name: "Detached" });
    const db = (repo as unknown as { db: { run(sql: string, values: number[]): void } }).db;
    db.run("UPDATE organization SET parent_id = ? WHERE id = ?", [second.id, first.id]);
    db.run("UPDATE organization SET parent_id = ? WHERE id = ?", [third.id, second.id]);
    db.run("UPDATE organization SET parent_id = ? WHERE id = ?", [first.id, third.id]);

    const originalGet = repo.getOrganization.bind(repo);
    let lookups = 0;
    repo.getOrganization = (id) => {
      if (++lookups > 10) throw new Error("unbounded ancestry walk");
      return originalGet(id);
    };
    expect(() => repo.updateOrganization(detached.id, { name: "Detached", parentId: first.id })).toThrow(
      ValidationError,
    );
    expect(lookups).toBeLessThanOrEqual(10);
  });

  it("refuses generated IDs beyond the exactly representable range before commit", async () => {
    const db = (
      repo as unknown as {
        db: { run(sql: string, values: (number | string)[]): void; exec(sql: string): { values: unknown[][] }[] };
      }
    ).db;
    db.run("INSERT INTO network (id, name, kind, marking) VALUES (?, ?, ?, ?)", [
      Number.MAX_SAFE_INTEGER,
      "High ID",
      "internal",
      "CUI",
    ]);

    expect(await codeOf(() => repo.createNetwork({ name: "Next", kind: "internal", marking: "CUI" }))).toBe(
      "UNSAFE_ID:id",
    );
    const names = db.exec("SELECT name FROM network ORDER BY name")[0]?.values.map((row) => row[0]);
    expect(names).toEqual(["High ID"]);
    expect(repo.canUndo()).toBe(false);
  });
});

describe("service draft command", () => {
  it("applies fields and owned relationships in one Undo step", () => {
    const s = seed();
    const base = repo.readServiceEditBase(s.mail.id);
    const before = repo.snapshot();

    const result = repo.applyServiceDraft(s.mail.id, base, {
      fields: { name: "Mail", networkId: s.nipr.id, marking: "CUI", providerOrgId: s.j6.id },
      support: [{ tier: 1, orgId: s.desk.id, notes: "Weekdays" }],
      consumerOrgIds: [s.desk.id],
      dependencies: [{ providerServiceId: s.idam.id, viaCdsId: null }],
    });
    expect(result.status).toBe("committed");
    expect(repo.getService(s.mail.id)?.name).toBe("Mail");
    expect(repo.getService(s.mail.id)?.applicationId).toBe(s.exchange.id);
    expect(repo.listSupport(s.mail.id)).toMatchObject([{ tier: 1, orgId: s.desk.id, notes: "Weekdays" }]);
    expect(repo.listConsumption()).toContainEqual({ orgId: s.desk.id, serviceId: s.mail.id });
    expect(repo.listDependencies()).toContainEqual({
      consumerServiceId: s.mail.id,
      providerServiceId: s.idam.id,
      viaCdsId: null,
    });
    expect(repo.undo()).toBe(true);
    expect(repo.snapshot()).toEqual(before);
  });

  it("accepts a final-state network move after replacing an invalid intermediate CDS route", () => {
    const s = seed();
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.patch.id, viaCdsId: s.cds.id });
    const base = repo.readServiceEditBase(s.mail.id);

    const result = repo.applyServiceDraft(s.mail.id, base, {
      fields: { name: "Email", networkId: s.sipr.id, marking: "SECRET", providerOrgId: s.j6.id },
      support: [],
      consumerOrgIds: [],
      dependencies: [{ providerServiceId: s.patch.id, viaCdsId: null }],
    });
    expect(result.status).toBe("committed");
    expect(repo.getService(s.mail.id)?.networkId).toBe(s.sipr.id);
    expect(
      repo.listDependencies().find((dependency) => dependency.consumerServiceId === s.mail.id)?.viaCdsId,
    ).toBeNull();
    expect(repo.undo()).toBe(true);
    expect(repo.getService(s.mail.id)?.networkId).toBe(s.nipr.id);
    expect(repo.listDependencies().find((dependency) => dependency.consumerServiceId === s.mail.id)?.viaCdsId).toBe(
      s.cds.id,
    );
  });

  it("revalidates an unrelated change but reports a relevant aggregate conflict", () => {
    const s = seed();
    const base = repo.readServiceEditBase(s.mail.id);
    repo.setPositions([{ entity: "service", id: s.mail.id, x: 5, y: 7 }]);
    repo.updateCategory(s.cyber.id, { name: "Cybersecurity", color: "#e0624f" });
    const draft = {
      fields: { name: "Mail", networkId: s.nipr.id, marking: "CUI" as const },
      support: [],
      consumerOrgIds: [],
      dependencies: [],
    };
    expect(repo.applyServiceDraft(s.mail.id, base, draft).status).toBe("committed");

    const stale = repo.readServiceEditBase(s.mail.id);
    repo.setSupport(s.mail.id, 1, s.desk.id, "Current desk");
    const before = repo.snapshot();
    const result = repo.applyServiceDraft(s.mail.id, stale, draft);
    expect(result.status).toBe("conflict");
    expect(repo.snapshot()).toEqual(before);
  });

  it("refuses a move that would break an incoming CDS route without deleting that route", () => {
    const s = seed();
    repo.addDependency({ consumerServiceId: s.patch.id, providerServiceId: s.mail.id, viaCdsId: s.cds.id });
    const base = repo.readServiceEditBase(s.mail.id);
    const before = repo.snapshot();
    const result = repo.applyServiceDraft(s.mail.id, base, {
      fields: { name: "Email", networkId: s.sipr.id, marking: "SECRET" },
      support: [],
      consumerOrgIds: [],
      dependencies: [],
    });
    expect(result.status).toBe("refused");
    expect(repo.snapshot()).toEqual(before);
  });
});
