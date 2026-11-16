import { expect, it } from "vitest";
import type { DatasetIssue } from "../db/semantics";
import { createDataset } from "../db/dataset";
import { Repository } from "../domain/repository";
import { wasm } from "../../tests/helpers/sqlite";
import { describeDataIssue } from "./data-issues";

it("names both exact service/network identities and the guard without parsing its machine witness", async () => {
  const db = await createDataset("Synthetic issue explanation", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const orders = repo.createService({ name: "Shared name", networkId: amber.id, marking: "UNCLASSIFIED" });
    const identity = repo.createService({ name: "Shared name", networkId: blue.id, marking: "UNCLASSIFIED" });
    const guard = repo.createCds({ name: "Amber Blue guard", networkIds: [amber.id, blue.id] });
    repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: guard.id });
    const snapshot = repo.snapshot();
    const before = JSON.stringify(snapshot);
    const issue: DatasetIssue = {
      code: "CDS_ROUTE",
      table: "service_dependency",
      rowId: `${String(orders.id)}:${String(identity.id)}`,
      witness: "opaque machine diagnostic",
      severity: "legacy",
    };
    const text = describeDataIssue(issue, snapshot);
    expect(text).toContain("Shared name (Amber) depends on Shared name (Blue)");
    expect(text).toContain("Amber Blue guard");
    expect(text).not.toContain(issue.witness);
    expect(JSON.stringify(snapshot)).toBe(before);
    const renamed = {
      ...snapshot,
      services: snapshot.services.map((item) => ({ ...item, name: `Updated ${item.name}` })),
    };
    expect(describeDataIssue(issue, renamed)).toContain("Updated Shared name (Amber)");
    expect(
      describeDataIssue({ ...issue, code: "CDS_ARITY", table: "cds", rowId: String(guard.id) }, snapshot),
    ).toContain("Currently joined: Amber, Blue");
  } finally {
    db.close();
  }
});

it("explains hierarchy and proposal issues with named records and bounded cycle traversal", async () => {
  const db = await createDataset("Synthetic hierarchy explanation", wasm);
  try {
    const repo = new Repository(db);
    const root = repo.createOrganization({ name: "Operations" });
    const team = repo.createOrganization({ name: "Support team", parentId: root.id });
    const plan = repo.createScenario({ name: "Consolidation" });
    const snapshot = repo.snapshot();
    const cyclic = {
      ...snapshot,
      organizations: snapshot.organizations.map((item) =>
        item.id === root.id ? { ...item, parentId: team.id } : item,
      ),
    };
    const issue: DatasetIssue = {
      code: "ORG_CYCLE",
      table: "organization",
      rowId: String(root.id),
      witness: "1 -> 2 -> 1",
      severity: "legacy",
    };
    expect(describeDataIssue(issue, cyclic)).toContain("Operations → Support team → Operations");
    const proposal = {
      ...snapshot,
      scenarioChanges: [
        { id: 7, scenarioId: plan.id, kind: "merge" as const, serviceId: 1, intoServiceId: null, intoChangeId: 9 },
        {
          id: 9,
          scenarioId: plan.id,
          kind: "add" as const,
          name: "Planned directory",
          networkId: 1,
          marking: "UNCLASSIFIED" as const,
          providerOrgId: null,
          description: null,
        },
      ],
    };
    expect(describeDataIssue({ ...issue, code: "SCENARIO_TARGET", rowId: "7" }, proposal)).toContain(
      "Planned directory (planned)",
    );
    expect(describeDataIssue({ ...issue, code: "SCENARIO_CHAIN", rowId: "7" }, proposal)).toContain(
      "Consolidation contains a loop",
    );
    expect(describeDataIssue({ ...issue, code: "UNSAFE_ID" }, snapshot)).toContain("exact supported range");
  } finally {
    db.close();
  }
});
