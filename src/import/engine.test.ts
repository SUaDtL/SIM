import { beforeEach, describe, expect, it } from "vitest";
import { snapshotRows } from "../../tests/helpers/csv-export";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset } from "../db/dataset";
import { populateDemo } from "../demo/demo";
import { Repository } from "../domain/repository";
import type { Snapshot } from "../domain/types";
import { parseCsv, toCsv } from "./csv";
import { describeAdded, runImport } from "./engine";
import { readTemplate, TEMPLATES, type TemplateFile, type TemplateType } from "./templates";

let repo: Repository;
beforeEach(async () => {
  repo = new Repository(await createDataset("Import", wasm));
});

/** A template file from rows, through the real CSV writer, parser and header check. */
function file(type: TemplateType, rows: string[][], name = `${type}.csv`): TemplateFile {
  const template = TEMPLATES.find((t) => t.type === type);
  if (!template) throw new Error(type);
  return readTemplate(name, parseCsv(toCsv([[...template.columns], ...rows])));
}

/** Every template's CSV for a snapshot, written as a user would fill them in. */
function exportCsv(s: Snapshot): TemplateFile[] {
  const rows = snapshotRows(s);
  return TEMPLATES.map((t) => file(t.type, rows[t.type]));
}

/** A snapshot with names in place of ids, for comparing datasets built separately. */
function byName(s: Snapshot): unknown {
  const n = (list: readonly { id: number; name: string }[], id: number | null) =>
    list.find((x) => x.id === id)?.name ?? null;
  const svc = (id: number) => {
    const x = s.services.find((v) => v.id === id);
    return `${x?.name ?? ""}@${n(s.networks, x?.networkId ?? 0) ?? ""}`;
  };
  const sorted = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).sort();
  return {
    networks: sorted(s.networks.map((x) => [x.name, x.kind, x.marking, x.description])),
    organizations: sorted(s.organizations.map((o) => [o.name, n(s.organizations, o.parentId)])),
    categories: sorted(s.categories.map((x) => [x.name, x.color])),
    applications: sorted(s.applications.map((x) => [x.name, x.vendor, x.description])),
    services: sorted(
      s.services.map((x) => [
        x.name,
        n(s.networks, x.networkId),
        x.marking,
        n(s.applications, x.applicationId),
        n(s.categories, x.categoryId),
        n(s.organizations, x.providerOrgId),
        x.foundational,
        x.description,
      ]),
    ),
    cds: sorted(s.cds.map((c) => [c.name, c.networkIds.map((id) => n(s.networks, id)).sort(), c.description])),
    support: sorted(s.support.map((x) => [svc(x.serviceId), x.tier, n(s.organizations, x.orgId), x.notes])),
    consumption: sorted(s.consumption.map((c) => [n(s.organizations, c.orgId), svc(c.serviceId)])),
    dependencies: sorted(
      s.dependencies.map((d) => [svc(d.consumerServiceId), svc(d.providerServiceId), n(s.cds, d.viaCdsId)]),
    ),
  };
}

describe("runImport", () => {
  it("rebuilds the demo enterprise from its CSV files, in any file order", async () => {
    const source = new Repository(await createDataset("Source", wasm));
    populateDemo(source);
    const files = exportCsv(source.snapshot()).reverse();
    const report = runImport(repo, files, { includeFlagged: false });
    expect(report.rejected).toEqual([]);
    expect(report.flagged).toEqual([]);
    expect(byName(repo.snapshot())).toEqual(byName(source.snapshot()));
  });

  it("reports rejected rows with their spreadsheet row and reason, and imports the rest", () => {
    const report = runImport(
      repo,
      [
        file("networks", [
          ["NIPR", "internal", "cui", ""],
          ["SIPR", "inside", "SECRET", ""],
          ["MPE", "internal", "SECRET-ISH", ""],
        ]),
        file("services", [
          ["Email", "NIPR", "CUI", "", "", "", "", ""],
          ["Chat", "SIPR", "SECRET", "", "", "", "", ""],
          ["DNS", "NIPR", "CUI", "", "", "", "", ""],
        ]),
      ],
      { includeFlagged: false },
    );
    expect(report.rejected).toEqual([
      { file: "networks.csv", row: 3, message: 'Kind must be internal or external, not "inside".' },
      { file: "networks.csv", row: 4, message: expect.stringContaining('not "SECRET-ISH"') as string },
      { file: "services.csv", row: 3, message: 'No network named "SIPR".' },
    ]);
    expect(report.added).toEqual({ networks: 1, services: 2 });
    expect(repo.listNetworks()[0]?.marking).toBe("CUI");
    expect(repo.listServices().find((s) => s.name === "DNS")?.foundational).toBe(true);
  });

  it("leaves existing records and links alone and reports repeats", () => {
    const nipr = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
    const j6 = repo.createOrganization({ name: "J6" });
    const j7 = repo.createOrganization({ name: "J7" });
    const mail = repo.createService({ name: "Email", networkId: nipr.id, marking: "CUI", description: "Keep me" });
    repo.setSupport(mail.id, 1, j6.id);
    const report = runImport(
      repo,
      [
        file("networks", [["nipr", "external", "SECRET", ""]]),
        file("services", [
          ["Email", "NIPR", "SECRET", "", "", "", "", "Replace me"],
          ["Chat", "NIPR", "CUI", "", "", "", "", ""],
          ["chat", "nipr", "CUI", "", "", "", "", ""],
        ]),
        file("support", [
          ["Email", "NIPR", "1", "J6", ""],
          ["Email", "NIPR", "Tier 1", "J7", ""],
        ]),
      ],
      { includeFlagged: false },
    );
    expect(report.present.map((p) => [p.row, p.message])).toEqual([
      [2, 'Network "nipr" is already in the dataset.'],
      [2, 'Service "Email" on NIPR is already in the dataset.'],
      [4, "Same as row 3 of services.csv."],
      [2, 'Tier 1 support for "Email" on NIPR is already in the dataset.'],
    ]);
    expect(report.rejected.map((r) => r.message)).toEqual([
      'Tier 1 support for "Email" on NIPR is already set to another organization.',
    ]);
    expect(repo.getService(mail.id)?.description).toBe("Keep me");
    expect(repo.listSupport(mail.id).map((s) => s.orgId)).toEqual([j6.id]);
    expect(j7.id).toBeGreaterThan(0);
  });

  it("leaves out rows that look like host data unless chosen, along with rows that need them", () => {
    const files = [
      file("networks", [["NIPR", "internal", "CUI", "Hosts on 10.1.2.3"]]),
      file("services", [["Email", "NIPR", "CUI", "", "", "", "", ""]]),
    ];
    const without = runImport(repo, files, { includeFlagged: false });
    expect(without.flagged).toEqual([{ file: "networks.csv", row: 2, message: "Looks like host data: 10.1.2.3" }]);
    expect(without.rejected.map((r) => r.message)).toEqual(['No network named "NIPR".']);
    expect(repo.listNetworks()).toHaveLength(0);

    const withFlagged = runImport(repo, files, { includeFlagged: true });
    expect(withFlagged.added).toEqual({ networks: 1, services: 1 });
  });

  it("sets organization parents that appear later in the file", () => {
    const report = runImport(
      repo,
      [
        file("organizations", [
          ["Help Desk", "IT"],
          ["IT", ""],
          ["Orphan", "Nobody"],
        ]),
      ],
      { includeFlagged: false },
    );
    const orgs = repo.listOrganizations();
    const it = orgs.find((o) => o.name === "IT");
    expect(orgs.find((o) => o.name === "Help Desk")?.parentId).toBe(it?.id);
    expect(report.rejected).toEqual([
      {
        file: "organizations.csv",
        row: 4,
        message: 'No organization named "Nobody". The organization was added without a parent.',
      },
    ]);
  });

  it("is one undo step that never merges into the edit before it, and notifies once", () => {
    repo.createNetwork({ name: "Before", kind: "internal", marking: "CUI" });
    let calls = 0;
    repo.subscribe(() => {
      calls++;
    });
    runImport(
      repo,
      [
        file("networks", [
          ["Bad", "inside", "CUI", ""],
          ["A", "internal", "CUI", ""],
          ["B", "internal", "CUI", ""],
        ]),
      ],
      { includeFlagged: false },
    );
    expect(calls).toBe(1);
    repo.undo();
    expect(repo.listNetworks().map((n) => n.name)).toEqual(["Before"]);
    repo.undo();
    expect(repo.listNetworks()).toEqual([]);
  });

  it("does not notify when nothing was written", () => {
    let calls = 0;
    repo.subscribe(() => {
      calls++;
    });
    runImport(repo, [file("networks", [["Bad", "inside", "CUI", ""]])], { includeFlagged: false });
    expect(calls).toBe(0);
    expect(repo.canUndo()).toBe(false);
  });
});

describe("readTemplate", () => {
  it("matches each template by its columns in any order and any case", () => {
    for (const t of TEMPLATES) {
      const header = [...t.columns].reverse().map((c) => c.toUpperCase().replace("_", " "));
      expect(readTemplate("x.csv", parseCsv(toCsv([header]))).template.type).toBe(t.type);
    }
  });

  it("refuses a misspelled, missing or doubled column, naming it", () => {
    const read = (header: string) => () => readTemplate("x.csv", parseCsv(header));
    expect(read("name,network,marking,application,categroy,provider,foundational,description")).toThrow(
      /unknown column "categroy"; missing "category"\)\. The Services template has/,
    );
    expect(read("name,kind,marking")).toThrow(/missing "description"/);
    expect(read("name,name")).toThrow(/appears twice/);
  });

  it("rejects a row with more values than columns", () => {
    const report = runImport(
      repo,
      [readTemplate("n.csv", parseCsv("name,kind,marking,description\nA,internal,CUI,,extra\n"))],
      {
        includeFlagged: false,
      },
    );
    expect(report.rejected[0]?.message).toMatch(/more values than the header/);
  });
});

describe("describeAdded", () => {
  it("lists what was added in import order, singular or plural", () => {
    expect(describeAdded({ services: 2, networks: 1, cds: 3 })).toBe("1 network, 2 services, 3 cross-domain solutions");
    expect(describeAdded({})).toBe("nothing");
  });
});
