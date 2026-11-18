import type { ScenarioChange } from "../domain/types";
import { button, el, focusPagingControl } from "../ui/dom";

/** A scenario owns the proposal list even when a map filter hides one of its subjects. */
export function scenarioProposals(describe: (change: ScenarioChange, all: readonly ScenarioChange[]) => string) {
  const pageSize = 6;
  let changes: readonly ScenarioChange[] = [];
  let scenario: number | null = null;
  let offset = 0;
  const title = el("summary");
  const list = el("ul");
  const range = el("span", { role: "status" });
  const previous = button(
    "Previous",
    () => {
      offset -= pageSize;
      renderPage();
      focusPagingControl(previous, next);
    },
    { "aria-label": "Previous proposed changes" },
  );
  const next = button(
    "Next",
    () => {
      offset += pageSize;
      renderPage();
      focusPagingControl(next, previous);
    },
    { "aria-label": "Next proposed changes" },
  );
  const paging = el("div", { class: "map-proposal-paging" }, previous, range, next);
  const element = el("details", { class: "map-proposals" }, title, list, paging);
  function renderPage(): void {
    if (!element.open) return;
    if (!changes.length) {
      list.replaceChildren(el("li", {}, "No changes proposed."));
      paging.hidden = true;
      return;
    }
    const start = Math.min(offset, Math.max(0, Math.floor((changes.length - 1) / pageSize) * pageSize));
    offset = Math.max(0, start);
    const end = Math.min(offset + pageSize, changes.length);
    list.replaceChildren(...changes.slice(offset, end).map((change) => el("li", {}, describe(change, changes))));
    paging.hidden = changes.length <= pageSize;
    previous.disabled = offset === 0;
    next.disabled = end === changes.length;
    range.textContent = `${String(offset + 1)}–${String(end)} of ${String(changes.length)}`;
  }
  element.addEventListener("toggle", renderPage);
  return {
    element,
    show(id: number | null, proposals: readonly ScenarioChange[]): void {
      if (scenario !== id) {
        offset = 0;
        element.open = false;
      }
      scenario = id;
      changes = proposals;
      element.hidden = id === null;
      title.textContent = `${String(changes.length)} proposed ${changes.length === 1 ? "change" : "changes"} across the scenario`;
      renderPage();
    },
  };
}
