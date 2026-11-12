import type { Repository } from "../domain/repository";
import { downloadBlob, suggestedImageName } from "../file/dataset-file";
import { createMapView } from "../map/map-view";
import { el } from "./dom";
import { createEditor } from "./editor-panel";
import { createListPanel } from "./list-panel";

export interface Workspace {
  readonly element: HTMLElement;
  /** Show a (new or reopened) dataset: drops the old selection and listens to the new repository. */
  setRepository(repo: Repository): void;
  /** Undo or redo ran: forms showing changed data are rebuilt. */
  historyChanged(): void;
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
  const map = createMapView({
    snapshot: () => repo.snapshot(),
    savePositions: (positions, history) => {
      repo.setPositions(positions, history);
    },
    saveImage: (image, extension) => {
      downloadBlob(image, suggestedImageName(repo.datasetName(), extension));
    },
    open: (type, id) => {
      editor.open(type, id);
    },
    openScenario: (id) => {
      editor.open("scenario", id);
    },
  });
  const element = el("main", { class: "workspace" }, list.element, map.element, editor.element);

  function setRepository(next: Repository): void {
    unsubscribe();
    repo = next;
    unsubscribe = repo.subscribe(() => {
      list.render();
      editor.refresh();
      map.refresh();
    });
    editor.close();
    list.render();
    map.reset();
  }

  setRepository(initial);
  return {
    element,
    setRepository,
    historyChanged: () => {
      editor.reload();
    },
  };
}
