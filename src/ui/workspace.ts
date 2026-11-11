import type { Repository } from "../domain/repository";
import { el } from "./dom";
import { createEditor } from "./editor-panel";
import { createListPanel } from "./list-panel";

export interface Workspace {
  readonly element: HTMLElement;
  /** Show a (new or reopened) dataset: drops the old selection and listens to the new repository. */
  setRepository(repo: Repository): void;
}

/** The three-region layout: entity list (left), map area (center), editor (right). */
export function createWorkspace(initial: Repository): Workspace {
  let repo = initial;
  let unsubscribe = (): void => undefined;

  const editor = createEditor({
    repo: () => repo,
    selectionChanged: () => {
      list.render();
    },
  });
  const list = createListPanel({
    repo: () => repo,
    selection: () => editor.selection(),
    select: (type, id) => {
      editor.open(type, id);
    },
  });
  const map = el(
    "section",
    { class: "map-area", "data-testid": "map-area", "aria-label": "Map" },
    el("h2", {}, "Map"),
    el("p", {}, "The service map will be drawn here."),
  );
  const element = el("main", { class: "workspace" }, list.element, map, editor.element);

  function setRepository(next: Repository): void {
    unsubscribe();
    repo = next;
    unsubscribe = repo.subscribe(() => {
      list.render();
      editor.refresh();
    });
    editor.close();
    list.render();
  }

  setRepository(initial);
  return { element, setRepository };
}
