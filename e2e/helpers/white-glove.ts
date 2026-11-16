import { createDataset } from "../../src/db/dataset";
import { Repository } from "../../src/domain/repository";
import { wasm } from "../../tests/helpers/sqlite";

/** E1: deterministic, fictional UNCLASSIFIED setup; mutations under test still use the UI. */
export async function whiteGloveFixture(
  options: { organizations?: number; allDependencies?: boolean; longNames?: boolean } = {},
): Promise<Uint8Array> {
  const db = await createDataset("Synthetic white-glove enterprise", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const operations = repo.createOrganization({ name: "Operations" });
    repo.createOrganization({ name: "Operations team", parentId: operations.id });
    repo.createOrganization({ name: "Customers" });
    for (let i = 3; i < (options.organizations ?? 3); i++)
      repo.createOrganization({ name: `Organization ${String(i + 1).padStart(3, "0")}` });
    repo.createApplication({ name: "Order workspace" });
    repo.createApplication({ name: "Identity workspace" });
    for (const name of ["Business", "Identity", "Foundation"]) repo.createCategory({ name });
    const guard = repo.createCds({ name: "Amber Blue guard", networkIds: [amber.id, blue.id] });
    const orders = repo.createService({
      name: "Orders",
      networkId: amber.id,
      providerOrgId: operations.id,
      marking: "UNCLASSIFIED",
    });
    const identity = repo.createService({
      name: options.longNames
        ? "Identity and Directory coordination for the synthetic engineering workspace"
        : "Identity",
      networkId: blue.id,
      marking: "UNCLASSIFIED",
    });
    const directory = repo.createService({ name: "Directory", networkId: blue.id, marking: "UNCLASSIFIED" });
    const duplicate = repo.createService({ name: "Orders", networkId: blue.id, marking: "UNCLASSIFIED" });
    repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: guard.id });
    repo.addDependency({ consumerServiceId: identity.id, providerServiceId: directory.id });
    if (options.allDependencies) {
      repo.addDependency({ consumerServiceId: orders.id, providerServiceId: directory.id, viaCdsId: guard.id });
      repo.addDependency({ consumerServiceId: orders.id, providerServiceId: duplicate.id, viaCdsId: guard.id });
    }
    repo.setPositions([
      { entity: "network", id: amber.id, x: 0, y: 0 },
      { entity: "network", id: blue.id, x: 500, y: 200 },
      { entity: "cds", id: guard.id, x: 150, y: 100 },
      ...[orders, identity, directory, duplicate].map((service, index) => ({
        entity: "service" as const,
        id: service.id,
        x: index * 180,
        y: index > 0 ? 200 : 0,
      })),
    ]);
    return db.export();
  } finally {
    db.close();
  }
}
