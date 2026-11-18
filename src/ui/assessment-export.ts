import type { OutputFormat } from "../assessment/output";
import { button, el, option } from "./dom";
import { assessmentPanel } from "./assessment-panel";

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
    const description = el("p", { class: "hint", role: "status" });
    const explain = (): void => {
      const summaries: Record<OutputFormat, string> = {
        html: "A read-only report with a contents index and printable tables. Current map scope also includes the captured map.",
        json: "Structured inventory with exact values and stable record IDs for analysis.",
        csv: "Tables for spreadsheets. Formula-like values are prefixed with an apostrophe.",
      };
      description.textContent = summaries[format.value as OutputFormat];
    };
    format.addEventListener("change", explain);
    explain();
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
      description,
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
    const heading = el("h2", { id: "assessment-export-heading", tabindex: "-1" }, "Export assessment or inventory");
    assessmentPanel(
      dialog,
      heading,
      () => {
        finish(null);
      },
      form,
    );
    document.body.append(dialog);
    dialog.showModal();
    heading.focus();
  });
}
