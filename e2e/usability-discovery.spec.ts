import { expect, test } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { editSelected, editorSection, openDatasetFile } from "./helpers/usability";

for (const searchName of ["outgoing dependencies", "incoming services", "consuming organizations", "joins networks"]) {
  test(`Enter in Search ${searchName} only searches and preserves the unapplied entity draft`, async ({ page }) => {
    const db = await createDataset("Synthetic local discovery", wasm);
    try {
      const repo = new Repository(db);
      const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
      const other = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
      const org = repo.createOrganization({ name: "Operations" });
      const subject = repo.createService({ name: "Orders", networkId: network.id, marking: "UNCLASSIFIED" });
      const provider = repo.createService({ name: "Identity", networkId: network.id, marking: "UNCLASSIFIED" });
      const consumer = repo.createService({ name: "Client", networkId: network.id, marking: "UNCLASSIFIED" });
      repo.addDependency({ consumerServiceId: subject.id, providerServiceId: provider.id });
      repo.addDependency({ consumerServiceId: consumer.id, providerServiceId: subject.id });
      repo.addConsumption(org.id, subject.id);
      repo.createCds({ name: "Guard", networkIds: [network.id, other.id] });
      await openDatasetFile(page, db.export(), "synthetic-discovery.sqlite");
    } finally {
      db.close();
    }
    const cds = searchName === "joins networks";
    await page.getByLabel("Show", { exact: true }).selectOption(cds ? "cds" : "service");
    await page
      .getByTestId("entity-list")
      .getByRole("button", { name: new RegExp(`^${cds ? "Guard" : "Orders"}\\b`) })
      .click();
    await editSelected(page);
    const editor = page.getByTestId("editor");
    const revisedName = cds ? "Guard revised  " : "Orders revised  ";
    await editor.getByLabel("Name", { exact: true }).fill(revisedName);
    if (!cds) await editorSection(page, "Connections");
    const query = editor.getByRole("searchbox", { name: `Search ${searchName}`, exact: true });
    await query.fill("No synthetic match");
    const priorStatus = await page.getByTestId("dataset-status").textContent();
    await query.press("Enter");
    await expect(editor).toHaveAttribute("data-mode", "edit");
    await expect(query).toBeFocused();
    await expect(query).toHaveValue("No synthetic match");
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(revisedName);
    await expect(page.getByTestId("draft-status")).toContainText("Unapplied changes");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
    await expect(page.getByTestId("dataset-status")).toHaveText(priorStatus ?? "");
  });
}
