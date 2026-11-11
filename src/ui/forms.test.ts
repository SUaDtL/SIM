import { beforeEach, describe, expect, it } from "vitest";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset } from "../db/dataset";
import { SensitiveInputWarning, ValidationError } from "../domain/errors";
import { Repository } from "../domain/repository";
import { ENTITY_TYPES, type EntityType, descriptor, fieldFor, type FormValues, suggestsFoundational } from "./forms";

let repo: Repository;

beforeEach(async () => {
  repo = new Repository(await createDataset("Test", wasm));
});

function seed() {
  const nipr = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  const sipr = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "SECRET" });
  const j6 = repo.createOrganization({ name: "J6" });
  const desk = repo.createOrganization({ name: "Desk", parentId: j6.id });
  const cyber = repo.createCategory({ name: "Cyber", color: "#e0624f" });
  const exchange = repo.createApplication({ name: "Exchange", vendor: "Microsoft", description: "Mail" });
  const mail = repo.createService({
    name: "Email",
    networkId: nipr.id,
    marking: "CUI",
    applicationId: exchange.id,
    categoryId: cyber.id,
    providerOrgId: j6.id,
    foundational: true,
    description: "Enterprise mail",
  });
  const guard = repo.createCds({ name: "Guard", networkIds: [nipr.id, sipr.id], description: "Mail guard" });
  return { nipr, sipr, j6, desk, cyber, exchange, mail, guard };
}

/** Save a form after changing only `changes`, then return the stored record. */
function editOnly(type: EntityType, id: number, changes: FormValues): unknown {
  const d = descriptor(type);
  const values = { ...d.values(repo, id), ...changes };
  d.save(repo, id, values);
  return d.get(repo, id);
}

describe("form model", () => {
  it("covers all six entity types", () => {
    expect(ENTITY_TYPES).toEqual(["network", "service", "organization", "application", "category", "cds"]);
  });

  it("round-trips every entity unchanged when only the name is edited", () => {
    const s = seed();
    const cases: [EntityType, number, object][] = [
      ["network", s.nipr.id, s.nipr],
      ["service", s.mail.id, s.mail],
      ["organization", s.desk.id, s.desk],
      ["application", s.exchange.id, s.exchange],
      ["category", s.cyber.id, s.cyber],
      ["cds", s.guard.id, s.guard],
    ];
    for (const [type, id, before] of cases) {
      const after = editOnly(type, id, { name: "Renamed " + type });
      expect(after).toEqual({ ...before, name: "Renamed " + type });
    }
  });

  it("creates each type from form values and lists it", () => {
    const s = seed();
    const created: Record<EntityType, FormValues> = {
      network: { name: "DEV", kind: "external", marking: "UNCLASSIFIED", description: "" },
      service: {
        name: "Chat",
        networkId: String(s.sipr.id),
        marking: "SECRET",
        applicationId: "",
        categoryId: "",
        providerOrgId: String(s.desk.id),
        foundational: false,
        description: "",
      },
      organization: { name: "J7", parentId: String(s.j6.id) },
      application: { name: "Teams", vendor: "", description: "" },
      category: { name: "C2", color: "" },
      cds: { name: "Cross Guard", networkIds: [String(s.nipr.id), String(s.sipr.id)], description: "" },
    };
    for (const type of ENTITY_TYPES) {
      const d = descriptor(type);
      const id = d.save(repo, null, created[type]);
      expect(d.list(repo).map((item) => item.name)).toContain(created[type]["name"]);
      expect(d.get(repo, id)).toBeDefined();
    }
    expect(repo.getService(repo.listServices().find((x) => x.name === "Chat")?.id ?? 0)).toMatchObject({
      providerOrgId: s.desk.id,
      applicationId: null,
      description: null,
    });
  });

  it("defaults a new service to the first network and offers network options", () => {
    const s = seed();
    const d = descriptor("service");
    expect(d.values(repo, null)["networkId"]).toBe(String(s.nipr.id));
    expect(d.values(repo, null)["marking"]).toBe("CUI");
    const networkField = d.fields.find((f) => f.key === "networkId");
    expect(networkField?.options?.(repo, null).map((o) => o.label)).toEqual(["NIPR", "SIPR"]);
  });

  it("excludes an organization from its own parent options", () => {
    const s = seed();
    const parent = descriptor("organization").fields.find((f) => f.key === "parentId");
    const labels = parent?.options?.(repo, s.j6.id).map((o) => o.label);
    expect(labels).not.toContain("J6");
    expect(labels).toContain("Desk");
  });

  it("deletes through the descriptor", () => {
    const s = seed();
    descriptor("cds").remove(repo, s.guard.id);
    expect(repo.listCds()).toEqual([]);
  });
});

describe("foundational default", () => {
  it("suggests foundational for services named Identity or DNS, ignoring case and spaces", () => {
    for (const name of ["Identity", "DNS", " dns ", "IDENTITY"]) expect(suggestsFoundational(name), name).toBe(true);
    for (const name of ["Email", "Identity Portal", "DNS2", ""]) expect(suggestsFoundational(name), name).toBe(false);
  });
});

describe("error field mapping", () => {
  /** Run a failing save and return the form key the UI would highlight for each reported field. */
  function keysFor(type: EntityType, id: number | null, values: FormValues): (string | null)[] {
    const d = descriptor(type);
    try {
      d.save(repo, id, { ...d.values(repo, id), ...values });
    } catch (error) {
      if (error instanceof ValidationError) return [fieldFor(type, error.field)];
      if (error instanceof SensitiveInputWarning) return error.findings.map((f) => fieldFor(type, f.field));
      throw error;
    }
    throw new Error("expected the save to be refused");
  }

  it("maps every field the repository reports to an input on that form", () => {
    const s = seed();
    const host = "mail.j6.example.mil";
    const cases: [EntityType, number | null, FormValues, string[]][] = [
      ["network", null, { name: " " }, ["name"]],
      ["network", null, { name: "NIPR" }, ["name"]],
      ["network", null, { name: "X", kind: "bogus" }, ["kind"]],
      ["network", null, { name: "X", marking: "bogus" }, ["marking"]],
      ["network", null, { name: host, description: "10.1.2.3" }, ["name", "description"]],
      ["organization", null, { name: "" }, ["name"]],
      ["organization", s.j6.id, { parentId: String(s.desk.id) }, ["parentId"]],
      ["organization", null, { name: host }, ["name"]],
      ["category", null, { name: "" }, ["name"]],
      ["category", null, { name: "X", color: "red" }, ["color"]],
      ["category", null, { name: host }, ["name"]],
      ["application", null, { name: "" }, ["name"]],
      ["application", null, { name: host, vendor: host, description: host }, ["name", "vendor", "description"]],
      ["service", null, { name: "" }, ["name"]],
      ["service", null, { name: "X", networkId: "9999" }, ["networkId"]],
      ["service", null, { name: "X", applicationId: "9999" }, ["applicationId"]],
      ["service", null, { name: "X", categoryId: "9999" }, ["categoryId"]],
      ["service", null, { name: "X", providerOrgId: "9999" }, ["providerOrgId"]],
      ["service", null, { name: "X", marking: "bogus" }, ["marking"]],
      ["service", null, { name: "Email", networkId: String(s.nipr.id) }, ["name"]],
      ["service", null, { name: host, description: host }, ["name", "description"]],
      ["cds", null, { name: "" }, ["name"]],
      ["cds", null, { name: "X", networkIds: [String(s.nipr.id)] }, ["networkIds"]],
      ["cds", null, { name: "X", networkIds: [String(s.nipr.id), "9999"] }, ["networkIds"]],
      [
        "cds",
        null,
        { name: host, networkIds: [String(s.nipr.id), String(s.sipr.id)], description: host },
        ["name", "description"],
      ],
    ];
    for (const [type, id, values, expected] of cases) {
      const keys = keysFor(type, id, values);
      expect({ type, values, keys }).toEqual({ type, values, keys: expected });
      const fieldKeys = descriptor(type).fields.map((f) => f.key);
      for (const key of keys) expect(fieldKeys).toContain(key);
    }
  });

  it("returns null for entity-level errors so they show on the form", () => {
    expect(fieldFor("network", "network")).toBeNull();
    expect(fieldFor("service", "service")).toBeNull();
  });
});
