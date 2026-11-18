import { button, el } from "./dom";
import "./assessment-workflows.css";

/** Keep the close action and the document title outside the scrolling records. */
export function assessmentPanel(
  dialog: HTMLElement,
  heading: HTMLElement,
  close: () => void,
  ...content: HTMLElement[]
) {
  let backAction: (() => void) | null = null;
  const back = button("Back", () => backAction?.(), { class: "workflow-back" });
  back.hidden = true;
  const dismiss = button("Close", close);
  const body = el("div", { class: "reading-body" }, ...content);
  dialog.classList.add("reading-panel");
  dialog.append(el("header", { class: "reading-heading" }, heading, dismiss, back), body);
  return {
    body,
    dismiss,
    setBack(label: string, action: (() => void) | null): void {
      back.textContent = label;
      back.hidden = !action;
      backAction = action;
    },
    cancel: (event: Event): void => {
      event.preventDefault();
      (backAction ?? close)();
    },
  };
}

export function assessmentOpener(): HTMLElement | null {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) return null;
  return focused.closest("details")?.querySelector<HTMLElement>(":scope > summary") ?? focused;
}
