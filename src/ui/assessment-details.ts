import {
  ASSESSMENT_FIELDS,
  ASSESSMENT_FIELDS_LIST,
  ASSESSMENT_TEXT_LIMIT,
  type AssessmentContextInput,
  type AssessmentField,
} from "../domain/assessment-context";
import { SensitiveInputWarning, ValidationError } from "../domain/errors";
import type { Repository } from "../domain/repository";
import { button, el } from "./dom";
import { assessmentPanel } from "./assessment-panel";

export function openAssessmentDetails(repo: Repository, active: () => boolean, saved: () => void) {
  const origin = document.querySelector<HTMLElement>("details.file-menu:not(.about-menu) > summary");
  const initial = repo.assessmentContext();
  const dialog = el("dialog", { class: "assessment-dialog", "aria-labelledby": "assessment-heading" });
  const heading = el("h2", { id: "assessment-heading", tabindex: "-1" }, "Assessment details");
  const entries = ASSESSMENT_FIELDS_LIST.map((key) => {
    const date = key === "startedOn" || key === "asOf";
    const control =
      date || key === "assessor"
        ? el("input", date ? { type: "date" } : { maxlength: String(ASSESSMENT_TEXT_LIMIT) })
        : el("textarea", { rows: "3", maxlength: String(ASSESSMENT_TEXT_LIMIT) });
    control.value = initial[key] ?? "";
    return [key, control] as const;
  });
  const fields = new Map<AssessmentField, HTMLInputElement | HTMLTextAreaElement>(entries);
  const problem = el("p", { role: "alert", class: "error" });
  const form = el("form");
  const hasDraft = (): boolean => dialog.open && entries.some(([key, input]) => input.value !== (initial[key] ?? ""));

  function cancel(): void {
    if (!hasDraft() || window.confirm("Discard unapplied assessment details?")) dialog.close();
  }
  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!active()) {
      dialog.close();
      return;
    }
    const input = Object.fromEntries(entries.map(([key, control]) => [key, control.value])) as AssessmentContextInput;
    try {
      try {
        repo.setAssessmentContext(input);
      } catch (error) {
        if (!(error instanceof SensitiveInputWarning)) throw error;
        if (!window.confirm(error.message) || !active()) return;
        repo.setAssessmentContext(input, { confirmSensitive: true });
      }
      dialog.close();
      saved();
    } catch (error) {
      problem.textContent = error instanceof ValidationError ? error.message : "Could not apply assessment details.";
      if (error instanceof ValidationError) fields.get(error.field as AssessmentField)?.focus();
    }
  }

  form.addEventListener("submit", submit);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancel();
  });
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      origin?.focus();
    },
    { once: true },
  );
  function fieldLabels(...keys: AssessmentField[]): HTMLLabelElement[] {
    return keys.flatMap((key) => {
      const control = fields.get(key);
      return control
        ? [el("label", { class: "assessment-field", "data-field": key }, ASSESSMENT_FIELDS[key], control)]
        : [];
    });
  }
  form.append(
    el(
      "p",
      {},
      "Describe what this assessment covers and when the information was current. These optional details travel with the exported assessment.",
    ),
    el(
      "fieldset",
      { class: "assessment-context-group" },
      el("legend", {}, "Coverage"),
      ...fieldLabels("description", "scope", "exclusions"),
    ),
    el(
      "fieldset",
      { class: "assessment-context-group assessment-attribution" },
      el("legend", {}, "Team and dates"),
      ...fieldLabels("assessor", "startedOn", "asOf"),
    ),
    problem,
    el("div", { class: "actions" }, button("Cancel", cancel), el("button", { type: "submit" }, "Apply details")),
  );
  assessmentPanel(
    dialog,
    heading,
    cancel,
    el("strong", { class: "assessment-context-dataset" }, repo.datasetName()),
    form,
  );
  document.body.append(dialog);
  dialog.showModal();
  heading.focus();
  return {
    hasDraft,
    close: () => {
      dialog.close();
    },
  };
}
