import type { OutputFormat } from "../assessment/output";
import { button, el, option } from "./dom";

export interface ExportChoice {
  readonly format: OutputFormat;
  readonly currentMap: boolean;
  readonly includeNotes: boolean;
}

export function chooseAssessmentExport(canExportMap: boolean): Promise<ExportChoice | null> {
  const origin = document.querySelector<HTMLElement>("details.file-menu:not(.about-menu) > summary");
  return new Promise((resolve) => {
    const dialog = el("dialog", { class: "assessment-dialog", "aria-labelledby": "assessment-export-heading" });
    const scope = el(
      "select",
      {},
      option("all", "All recorded As-Is inventory"),
      ...(canExportMap ? [option("map", "Current map scope", true)] : []),
    );
    const format = el(
      "select",
      {},
      option("html", "Read-only HTML assessment"),
      option("json", "Inventory JSON"),
      option("csv", "Display CSV"),
    );
    const includeNotes = el("input", { type: "checkbox" });
    const form = el(
      "form",
      {},
      el(
        "p",
        {},
        "The export keeps the full dataset marking and caveat. Current map scope includes only the displayed inventory and omits assessment-level details.",
      ),
      el("label", { class: "assessment-field" }, "Export scope", scope),
      el("label", { class: "assessment-field" }, "Format", format),
      el("label", {}, includeNotes, " Include in-scope evidence and questions"),
      el(
        "div",
        { class: "actions" },
        button("Cancel", () => {
          finish(null);
        }),
        el("button", { type: "submit" }, "Export"),
      ),
    );
    function finish(choice: ExportChoice | null): void {
      dialog.close();
      dialog.remove();
      origin?.focus();
      resolve(choice);
    }
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish({
        format: format.value as OutputFormat,
        currentMap: scope.value === "map",
        includeNotes: includeNotes.checked,
      });
    });
    dialog.append(el("h2", { id: "assessment-export-heading" }, "Export assessment or inventory"), form);
    document.body.append(dialog);
    dialog.showModal();
  });
}
