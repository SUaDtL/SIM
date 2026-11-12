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
  hasPendingDraft(): boolean;
  pendingDraftLabel(): string;
  applyActiveDraft(): boolean;
  discardActiveDraft(): void;
  resolveActiveDraft(kind: "navigate" | "history" | "import" | "capture"): Promise<boolean>;
  sessionIdentity(): number;
  activeDraftToken(): number;
  settlePendingPlacement(): Promise<void>;
}

/** The three-region layout: entity list (left), map area (center), editor (right). */
export function createWorkspace(
  initial: Repository,
  onDraftChanged: () => void = () => undefined,
  captureUnsaved: () => boolean = () => true,
): Workspace {
  let repo = initial;
  let unsubscribe = (): void => undefined;
  let sessionId = 0;
  let draftToken = 0;

  function chooseDraftAction(
    kind: "navigate" | "history" | "import" | "capture",
  ): Promise<"apply" | "discard" | "stay"> {
    return new Promise((resolve) => {
      const dialog = el("dialog", { "aria-label": "Unapplied changes" });
      const title =
        kind === "capture"
          ? `Capture the current map? ${editor.pendingDraftLabel()} is pending.`
          : `${editor.pendingDraftLabel()} is pending. Choose how to continue.`;
      const choices: readonly [string, "apply" | "discard" | "stay"][] =
        kind === "history"
          ? [
              ["Discard draft and continue", "discard"],
              ["Keep editing", "stay"],
            ]
          : kind === "capture"
            ? [
                ["Apply and capture", "apply"],
                ["Capture current view", "discard"],
                ["Cancel", "stay"],
              ]
            : [
                ["Apply and continue", "apply"],
                ["Discard and continue", "discard"],
                ["Stay", "stay"],
              ];
      const settle = (choice: "apply" | "discard" | "stay"): void => {
        dialog.close();
        dialog.remove();
        resolve(choice);
      };
      dialog.append(
        el("p", {}, title),
        ...choices.map(([label, choice]) => {
          const control = el("button", { type: "button" }, label);
          control.addEventListener("click", () => {
            settle(choice);
          });
          return control;
        }),
      );
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        settle("stay");
      });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  async function resolveActiveDraft(kind: "navigate" | "history" | "import" | "capture"): Promise<boolean> {
    if (!editor.hasPendingDraft()) return true;
    const choice = await chooseDraftAction(kind);
    if (choice === "stay") return false;
    if (choice === "apply") {
      if (!editor.applyActiveDraft()) return false;
      if (kind === "capture") await map.settlePendingPlacement();
      return true;
    }
    if (kind !== "capture") editor.discardActiveDraft();
    return true;
  }

  async function open(type: Parameters<typeof editor.open>[0], id: number | null): Promise<void> {
    if (editor.selection()?.type === type && editor.selection()?.id === id) return;
    if (!(await resolveActiveDraft("navigate"))) return;
    editor.open(type, id);
  }

  const editor = createEditor({
    repo: () => repo,
    selectionChanged: () => {
      list.render();
    },
    draftChanged: () => {
      draftToken++;
      onDraftChanged();
    },
    requestServiceOnNetwork: (networkId) => {
      void (async () => {
        if (await resolveActiveDraft("navigate")) editor.openServiceOnNetwork(networkId);
      })();
    },
  });
  const list = createListPanel({
    repo: () => repo,
    selection: () => editor.selection(),
    select: (type, id) => {
      void open(type, id);
    },
  });
  const map = createMapView({
    snapshot: () => repo.snapshot(),
    resolveCapture: async () => ((await resolveActiveDraft("capture")) ? "capture" : "cancel"),
    captureSource: () => ({
      sessionId,
      name: repo.datasetName(),
      revision: repo.currentRevision(),
      unsaved: captureUnsaved(),
    }),
    savePositions: (positions, history, origin?: { sessionId: number; revision: number }) => {
      if (origin && (origin.sessionId !== sessionId || origin.revision !== repo.currentRevision())) return;
      repo.setPositions(positions, history);
    },
    saveImage: (image, extension, capturedName) => {
      downloadBlob(image, suggestedImageName(capturedName, extension));
    },
    open: (type, id) => {
      void open(type, id);
    },
    openScenario: (id) => {
      void open("scenario", id);
    },
    inspectNode: (node, view, projected, comparison) => {
      void (async () => {
        const before = repo.currentRevision();
        if (!(await resolveActiveDraft("navigate"))) return;
        if (repo.currentRevision() !== before) {
          map.refresh();
          if (!map.inspectOrigin(node.data.origin)) editor.close();
          return;
        }
        editor.inspectProjected(node, view, projected, comparison, {
          editAsIs: (entity, id) => {
            map.showAsIs();
            editor.open(entity, id);
          },
          openScenario: (id) => {
            editor.open("scenario", id);
          },
        });
      })();
    },
  });
  const element = el("main", { class: "workspace" }, list.element, map.element, editor.element);

  function setRepository(next: Repository): void {
    unsubscribe();
    repo = next;
    sessionId++;
    unsubscribe = repo.subscribe(() => {
      const errors: unknown[] = [];
      const refreshers = [
        (): void => {
          list.render();
        },
        (): void => {
          editor.refresh();
        },
        (): void => {
          map.refresh();
        },
      ];
      for (const refresh of refreshers) {
        try {
          refresh();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, "The workspace could not fully refresh.");
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
    hasPendingDraft: () => editor.hasPendingDraft(),
    pendingDraftLabel: () => editor.pendingDraftLabel(),
    applyActiveDraft: () => editor.applyActiveDraft(),
    discardActiveDraft: () => {
      editor.discardActiveDraft();
    },
    resolveActiveDraft,
    sessionIdentity: () => sessionId,
    activeDraftToken: () => draftToken,
    settlePendingPlacement: () => map.settlePendingPlacement(),
  };
}
