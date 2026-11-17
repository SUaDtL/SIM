import { applyBatch, previewBatch, type Assignment, type AssignmentTarget, type BatchPlan } from "../assessment/upkeep";
import type { Repository } from "../domain/repository";
import type { Tier } from "../domain/types";
import { button, el, option } from "./dom";

export function openBatchAssignment(repo: Repository, done: (count: number) => void): HTMLDialogElement {
  const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const snapshot = repo.snapshot();
  const networks = new Map(snapshot.networks.map(({ id, name }) => [id, name]));
  const identities = repo.exchangeIdentities("service");
  const rows = snapshot.services.flatMap(({ id, name, networkId }) => {
    const identity = identities.get(String(id));
    return identity ? [{ id: identity, label: `${name} (${networks.get(networkId) ?? "Unknown network"})` }] : [];
  });
  const chosen = new Map<string, AssignmentTarget>();
  const dialog = el("dialog", { class: "assessment-dialog", "aria-labelledby": "batch-assignment-heading" });
  const body = el("div");
  const alert = el("p", { role: "alert" });
  const heading = el("h2", { id: "batch-assignment-heading", tabindex: "-1" }, "Batch assignments");
  const query = el("input", { type: "search" });
  const targets = el("select");
  const tier = el("select", {}, ...[1, 2, 3].map((n) => option(String(n), `Tier ${String(n)}`)));
  const field = el(
    "select",
    {},
    option("provider", "Provider"),
    option("category", "Category"),
    option("support", "Support organization"),
  );
  let page = 0;
  let preview: BatchPlan | null = null;

  function syncTargets(): void {
    const records = field.value === "category" ? repo.listCategories() : repo.listOrganizations();
    targets.replaceChildren(
      option("", "Choose an existing record"),
      ...records.map(({ id, name }) => option(String(id), name)),
    );
  }
  field.addEventListener("change", () => {
    syncTargets();
    select();
  });
  query.addEventListener("input", () => {
    page = 0;
    select();
  });
  syncTargets();

  function select(): void {
    preview = null;
    const matching = rows.filter(({ label }) => label.toLowerCase().includes(query.value.trim().toLowerCase()));
    const previous = button("Previous", () => {
      page--;
      select();
      heading.focus();
    });
    const next = button("Next", () => {
      page++;
      select();
      heading.focus();
    });
    previous.disabled = page === 0;
    next.disabled = (page + 1) * 20 >= matching.length;
    const count = el("p", { role: "status" });
    const list = el("fieldset", {}, el("legend", {}, "Services to include"));
    for (const item of matching.slice(page * 20, (page + 1) * 20)) {
      const check = el("input", { type: "checkbox" });
      check.checked = chosen.has(item.id);
      check.addEventListener("change", () => {
        if (check.checked) chosen.set(item.id, item);
        else chosen.delete(item.id);
        count.textContent = `${String(chosen.size)} selected across all pages.`;
      });
      list.append(el("label", { class: "batch-choice" }, check, item.label));
    }
    count.textContent = `${String(chosen.size)} selected across all pages.`;
    body.replaceChildren(
      el("label", { class: "assessment-field" }, "Find services", query),
      count,
      list,
      el("div", { class: "actions" }, previous, next),
      el("label", { class: "assessment-field" }, "Assignment", field),
      el("label", { class: "assessment-field" }, "Existing record to assign", targets),
      ...(field.value === "support" ? [el("label", { class: "assessment-field" }, "Support tier", tier)] : []),
      el(
        "div",
        { class: "actions" },
        button("Cancel", () => {
          dialog.close();
        }),
        button("Preview assignments", () => {
          try {
            if (!targets.value) throw new Error("Choose a record to assign.");
            preview = previewBatch(
              repo,
              [...chosen.values()],
              field.value as Assignment,
              Number(tier.value) as Tier,
              Number(targets.value),
            );
            review(preview);
            heading.focus();
          } catch (error) {
            alert.textContent = error instanceof Error ? error.message : "Could not prepare this batch.";
          }
        }),
      ),
    );
  }

  function review(plan: BatchPlan): void {
    alert.textContent = "";
    const changes = plan.changes.filter((row) => row.before !== plan.to);
    body.replaceChildren(
      el(
        "p",
        {},
        `${String(plan.changes.length)} selected. ${String(changes.length)} assignments will change. Support notes and map positions are retained.`,
      ),
      el(
        "ul",
        {},
        ...plan.changes.map((row) =>
          el(
            "li",
            {},
            `${row.label}: ${row.beforeLabel} → ${plan.targetLabel}${row.before === plan.to ? " (no change)" : ""}`,
          ),
        ),
      ),
      el(
        "div",
        { class: "actions" },
        button("Back to selection", () => {
          select();
          heading.focus();
        }),
        button("Apply assignments", () => {
          if (preview !== plan) return;
          try {
            const applied = applyBatch(repo, plan);
            dialog.close();
            done(applied);
          } catch (error) {
            alert.textContent = error instanceof Error ? error.message : "Could not apply the batch.";
          }
        }),
      ),
    );
  }

  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      origin?.focus();
    },
    { once: true },
  );
  dialog.append(heading, alert, body);
  document.body.append(dialog);
  select();
  dialog.showModal();
  heading.focus();
  return dialog;
}
