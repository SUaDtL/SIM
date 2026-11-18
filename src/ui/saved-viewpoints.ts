import { SensitiveInputWarning } from "../domain/errors";
import type { Repository } from "../domain/repository";
import type { Viewpoint } from "../map/viewpoint";
import { button, el, focusPagingControl } from "./dom";
import { assessmentOpener, assessmentPanel } from "./assessment-panel";

type SavedView = ReturnType<Repository["listViewpoints"]>[number];

export function manageViewpoints(
  repo: Repository,
  capture: () => Viewpoint,
  restore: (view: SavedView) => void,
  onDraft: (pending: boolean) => void,
): HTMLDialogElement {
  const origin = assessmentOpener();
  const heading = el("h2", { id: "saved-views-heading", tabindex: "-1" }, "Saved views");
  const dialog = el("dialog", { class: "assessment-dialog", "aria-labelledby": heading.id });
  const problem = el("p", { role: "alert", class: "error" });
  const body = el("div");
  const query = el("input", { type: "search", "aria-label": "Filter saved views" });
  const results = el("div");
  const status = el("p", { role: "status" });
  let page = 0;
  let pending = false;
  const previous = button("Previous", () => {
    page--;
    refreshResults();
    focusPagingControl(previous, next);
  });
  const next = button("Next", () => {
    page++;
    refreshResults();
    focusPagingControl(next, previous);
  });

  function setPending(value: boolean): void {
    pending = value;
    onDraft(value);
  }

  function close(): void {
    if (!pending || window.confirm("Discard this unapplied view definition?")) dialog.close();
  }

  function showAll(): void {
    panel.setBack("", null);
    setPending(false);
    body.replaceChildren(
      el("p", {}, "Saved views open over the current dataset and its current map positions."),
      el("label", { class: "assessment-field" }, "Filter saved views", query),
      el(
        "div",
        { class: "actions reading-tools" },
        button(
          "Save current view",
          () => {
            edit();
          },
          { "data-view-origin": "new" },
        ),
      ),
      status,
      results,
      el("div", { class: "actions" }, previous, next),
    );
    refreshResults();
  }

  function refreshResults(): void {
    const needle = query.value.trim().toLowerCase();
    const matching = repo
      .listViewpoints()
      .filter(({ name, caption }) => [name, caption].join(" ").toLowerCase().includes(needle));
    const lastPage = Math.max(0, Math.ceil(matching.length / 12) - 1);
    page = Math.min(page, lastPage);
    previous.disabled = page === 0;
    next.disabled = page >= lastPage;
    previous.hidden = next.hidden = lastPage === 0;
    if (matching.length === 0) {
      status.textContent = needle ? "No matching saved views." : "No views saved yet.";
      results.replaceChildren();
      return;
    }
    const count = `${String(matching.length)} ${matching.length === 1 ? "view" : "views"}`;
    status.textContent = lastPage ? `${count} · Page ${String(page + 1)} of ${String(lastPage + 1)}` : count;
    const list = el("ul", { class: "saved-view-list" });
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
              { "aria-label": `Edit ${row.name}`, "data-view-origin": row.id },
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
    results.replaceChildren(list);
  }

  function edit(row?: SavedView): void {
    const scroll = panel.body.scrollTop;
    const resumeList = (): void => {
      showAll();
      const opener = body.querySelector<HTMLElement>(`[data-view-origin="${CSS.escape(row?.id ?? "new")}"]`);
      (opener ?? query).focus({ preventScroll: true });
      panel.body.scrollTop = scroll;
    };
    const back = (): void => {
      if (!pending || window.confirm("Discard this unapplied view definition?")) resumeList();
    };
    panel.setBack("Back to saved views", back);
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
        button("Cancel", back),
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
        resumeList();
      } catch (error) {
        problem.textContent = error instanceof Error ? error.message : "Could not save the view.";
      }
    });
    body.replaceChildren(form);
    name.focus();
  }

  query.addEventListener("input", () => {
    page = 0;
    refreshResults();
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
  const panel = assessmentPanel(dialog, heading, close, problem, body);
  dialog.addEventListener("cancel", panel.cancel);
  document.body.append(dialog);
  showAll();
  dialog.showModal();
  heading.focus();
  return dialog;
}
