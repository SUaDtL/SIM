import { openReferencePicker, type ReferencePicker } from "./reference-picker";
import { SensitiveInputWarning } from "../domain/errors";
import { applyBatch, previewBatch, type Assignment, type AssignmentTarget, type BatchPlan } from "../assessment/upkeep";
import type { Repository } from "../domain/repository";
import type { Tier } from "../domain/types";
import { button, el, option, focusPagingControl } from "./dom";
import { assessmentPanel } from "./assessment-panel";

export function openBatchAssignment(
  repo: Repository,
  done: (count: number) => void,
  draftChanged: (pending: boolean) => void,
): HTMLDialogElement {
  const origin = document.querySelector<HTMLElement>("details.workspace-assessment > summary");
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
  let targetId = "";
  let picker: ReferencePicker | null = null;
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

  const available = () => (field.value === "category" ? repo.listCategories() : repo.listOrganizations());
  const choose = button("Choose record to assign", () => {
    const category = field.value === "category";
    const label = category ? "category" : "organization";
    picker = openReferencePicker({
      label,
      options: () => available().map((row) => ({ value: String(row.id), label: row.name })),
      selectedValue: targetId,
      returnFocus: choose,
      isCurrent: () => dialog.open,
      onSelect: (value) => {
        targetId = value;
        syncTarget();
      },
      onDraftChanged: () => {
        draftChanged(picker?.hasPendingDraft() ?? false);
      },
      create: (initial, complete, back, trackDraft) => {
        const input = el("input", { required: "", maxlength: "200" });
        input.value = initial;
        const message = el("p", { role: "alert" });
        const form = el(
          "form",
          {},
          el("label", { class: "assessment-field" }, `New ${label} name`, input),
          el(
            "p",
            { class: "hint" },
            "Creating this shared record keeps it in the dataset even if you cancel the batch assignment.",
          ),
          message,
          el("div", { class: "actions" }, button("Cancel", back), el("button", { type: "submit" }, "Create and use")),
        );
        trackDraft(() => input.value.trim() !== "");
        input.addEventListener("input", () => {
          draftChanged(picker?.hasPendingDraft() ?? false);
        });
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          if (!dialog.open) return;
          const name = input.value;
          const create = (confirmSensitive: boolean) =>
            category
              ? repo.createCategory({ name }, { confirmSensitive })
              : repo.createOrganization({ name }, { confirmSensitive });
          try {
            let row;
            try {
              row = create(false);
            } catch (error) {
              if (!(error instanceof SensitiveInputWarning)) throw error;
              if (!window.confirm(error.message) || input.value !== name) return;
              row = create(true);
            }
            alert.textContent = `${row.name} created. Batch assignments still need your preview and approval.`;
            complete(String(row.id));
          } catch (error) {
            message.textContent = error instanceof Error ? error.message : "Could not create this shared record.";
          }
        });
        return form;
      },
    });
    draftChanged(picker.hasPendingDraft());
  });

  function syncTarget(): void {
    choose.textContent = available().find((row) => String(row.id) === targetId)?.name ?? "Choose record to assign";
  }
  const list = el("fieldset");
  const count = el("p", { role: "status" });
  const tierField = el("label", { class: "assessment-field" }, "Support tier", tier);
  const previous = button("Previous", () => {
    page--;
    showRows();
    focusPagingControl(previous, next);
  });
  const next = button("Next", () => {
    page++;
    showRows();
    focusPagingControl(next, previous);
  });
  const previewButton = button("Preview assignments", () => {
    try {
      if (!targetId) throw new Error("Choose a record to assign.");
      preview = previewBatch(
        repo,
        [...chosen.values()],
        field.value as Assignment,
        Number(tier.value) as Tier,
        Number(targetId),
      );
      review(preview);
      panel.body.scrollTop = 0;
      heading.focus();
    } catch (error) {
      alert.textContent = error instanceof Error ? error.message : "Could not prepare this batch.";
      alert.scrollIntoView({ block: "nearest" });
    }
  });
  const selection = el(
    "div",
    {},
    el("p", {}, "Choose services and an assignment, then preview the changes before applying them."),
    el("label", { class: "assessment-field" }, "Find services", query),
    count,
    list,
    el("div", { class: "actions" }, previous, next),
    el("label", { class: "assessment-field" }, "Assignment", field),
    el("div", { class: "assessment-field" }, "Record to assign", choose),
    tierField,
    el("div", { class: "actions" }, previewButton),
  );
  field.addEventListener("change", () => {
    targetId = "";
    syncTarget();
    tierField.hidden = field.value !== "support";
  });
  query.addEventListener("input", () => {
    page = 0;
    showRows();
  });

  function showRows(): void {
    const matching = rows.filter(({ label }) => label.toLowerCase().includes(query.value.trim().toLowerCase()));
    previous.disabled = page === 0;
    next.disabled = (page + 1) * 20 >= matching.length;
    previous.hidden = next.hidden = matching.length <= 20;
    const visible = matching.slice(page * 20, (page + 1) * 20);
    const updateCount = (): void => {
      const start = page * 20 + 1;
      const result =
        matching.length === 0
          ? "No matching services"
          : `${String(start)}–${String(start + visible.length - 1)} of ${String(matching.length)} services`;
      count.textContent = `${result} · ${String(chosen.size)} selected across all pages.`;
    };
    list.replaceChildren(el("legend", {}, "Services to include"));
    list.hidden = visible.length === 0;
    for (const item of visible) {
      const check = el("input", { type: "checkbox" });
      check.checked = chosen.has(item.id);
      check.addEventListener("change", () => {
        if (check.checked) chosen.set(item.id, item);
        else chosen.delete(item.id);
        updateCount();
      });
      list.append(el("label", { class: "batch-choice" }, check, item.label));
    }
    updateCount();
  }

  function select(): void {
    preview = null;
    panel.setBack("", null);
    tierField.hidden = field.value !== "support";
    showRows();
    body.replaceChildren(selection);
  }

  function review(plan: BatchPlan): void {
    panel.setBack("Back to selection", () => {
      select();
      previewButton.focus();
    });
    alert.textContent = "";
    const changes = plan.changes.filter((row) => row.before !== plan.to);
    body.replaceChildren(
      el(
        "p",
        {},
        `${String(plan.changes.length)} selected. ${String(changes.length)} ${changes.length === 1 ? "assignment" : "assignments"} will change. Support notes and map positions are retained.`,
      ),
      el(
        "ul",
        { class: "workflow-list" },
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
      picker?.close();
      draftChanged(false);
      dialog.remove();
      origin?.focus();
    },
    { once: true },
  );
  const panel = assessmentPanel(
    dialog,
    heading,
    () => {
      dialog.close();
    },
    alert,
    body,
  );
  dialog.addEventListener("cancel", panel.cancel);
  document.body.append(dialog);
  select();
  dialog.showModal();
  heading.focus();
  return dialog;
}
