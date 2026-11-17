import { SensitiveInputWarning } from "../domain/errors";
import type { Repository } from "../domain/repository";
import type { Viewpoint } from "../map/viewpoint";
import { button, el } from "./dom";

type SavedView = ReturnType<Repository["listViewpoints"]>[number];

export function manageViewpoints(
  repo: Repository,
  capture: () => Viewpoint,
  restore: (view: SavedView) => void,
  onDraft: (pending: boolean) => void,
): HTMLDialogElement {
  const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const heading = el("h2", { id: "saved-views-heading", tabindex: "-1" }, "Saved views");
  const dialog = el("dialog", { class: "assessment-dialog", "aria-labelledby": heading.id });
  const problem = el("p", { role: "alert", class: "error" });
  const body = el("div");
  const query = el("input", { type: "search", "aria-label": "Filter saved views" });
  let page = 0;
  let pending = false;

  function setPending(value: boolean): void {
    pending = value;
    onDraft(value);
  }

  function close(): void {
    if (!pending || window.confirm("Discard this unapplied view definition?")) dialog.close();
  }

  function showAll(): void {
    setPending(false);
    const matching = repo
      .listViewpoints()
      .filter(({ name }) => name.toLowerCase().includes(query.value.trim().toLowerCase()));
    const lastPage = Math.max(0, Math.ceil(matching.length / 12) - 1);
    page = Math.min(page, lastPage);
    const list = el("ul");
    for (const row of matching.slice(page * 12, (page + 1) * 12)) {
      list.append(
        el(
          "li",
          {},
          el("strong", {}, row.name),
          row.caption ? el("p", {}, row.caption) : null,
          el(
            "div",
            { class: "actions" },
            button(
              "Restore",
              () => {
                try {
                  restore(row);
                  dialog.close();
                } catch (error) {
                  problem.textContent = error instanceof Error ? error.message : "Could not restore this saved view.";
                }
              },
              { "aria-label": `Restore ${row.name}` },
            ),
            button(
              "Edit",
              () => {
                edit(row);
              },
              { "aria-label": `Edit ${row.name}` },
            ),
            button(
              "Delete",
              () => {
                if (!window.confirm(`Delete the saved view “${row.name}”?`)) return;
                repo.deleteViewpoint(row.id);
                showAll();
                heading.focus();
              },
              { "aria-label": `Delete ${row.name}` },
            ),
          ),
        ),
      );
    }
    const previous = button("Previous", () => {
      page--;
      showAll();
    });
    const next = button("Next", () => {
      page++;
      showAll();
    });
    previous.disabled = page === 0;
    next.disabled = page >= lastPage;
    body.replaceChildren(
      el("p", {}, "Saved views open over the current dataset and its current map positions."),
      query,
      matching.length === 0 ? el("p", {}, "No matching saved views.") : list,
      el(
        "div",
        { class: "actions" },
        previous,
        next,
        button("Save current view", () => {
          edit();
        }),
        button("Close", close),
      ),
    );
  }

  function edit(row?: SavedView): void {
    problem.textContent = "";
    const name = el("input", { required: "", maxlength: "200" });
    const caption = el("textarea", { rows: "3", maxlength: "4000" });
    const replace = el("input", { type: "checkbox" });
    name.value = row?.name ?? "";
    caption.value = row?.caption ?? "";
    const form = el(
      "form",
      {},
      el("label", { class: "assessment-field" }, "View name", name),
      el("label", { class: "assessment-field" }, "Caption or question (optional)", caption),
      row ? el("label", {}, replace, " Replace saved scope and framing with the current map") : null,
      el(
        "div",
        { class: "actions" },
        button("Cancel", () => {
          if (!pending || window.confirm("Discard this unapplied view definition?")) {
            showAll();
            heading.focus();
          }
        }),
        el("button", { type: "submit" }, row ? "Apply view changes" : "Save view"),
      ),
    );
    form.addEventListener("input", () => {
      setPending(name.value !== (row?.name ?? "") || caption.value !== (row?.caption ?? "") || replace.checked);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const input = {
          name: name.value,
          caption: caption.value,
          definition: row && !replace.checked ? row.definition : capture(),
        };
        try {
          repo.saveViewpoint(input, row?.id);
        } catch (error) {
          if (!(error instanceof SensitiveInputWarning)) throw error;
          if (!window.confirm(error.message)) return;
          repo.saveViewpoint(input, row?.id, { confirmSensitive: true });
        }
        showAll();
        heading.focus();
      } catch (error) {
        problem.textContent = error instanceof Error ? error.message : "Could not save the view.";
      }
    });
    body.replaceChildren(form);
    name.focus();
  }

  query.addEventListener("input", () => {
    page = 0;
    showAll();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener(
    "close",
    () => {
      setPending(false);
      dialog.remove();
      if (origin?.isConnected) origin.focus();
    },
    { once: true },
  );
  dialog.append(heading, problem, body);
  document.body.append(dialog);
  showAll();
  dialog.showModal();
  heading.focus();
  return dialog;
}
