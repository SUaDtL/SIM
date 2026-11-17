import {
  ASSERTIONS,
  FINDINGS,
  NOTE_BASES,
  REVIEW_STATES,
  type NoteInput,
  type NoteKind,
  type NoteTarget,
  type ReadAssessmentNote,
} from "../assessment/notes";
import { MARKINGS, type Marking } from "../db/markings";
import { SensitiveInputWarning } from "../domain/errors";
import type { Repository } from "../domain/repository";
import { button, el, option } from "./dom";

export function openAssessmentNotes(repo: Repository, onDraft: (pending: boolean) => void, scope?: NoteTarget) {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const origin = scope
    ? (focused?.closest("details")?.querySelector<HTMLElement>("summary") ?? focused)
    : document.querySelector<HTMLElement>("details.file-menu:not(.about-menu) > summary");
  const heading = el("h2", { id: "assessment-notes-heading", tabindex: "-1" }, "Assessment evidence and questions");
  const dialog = el("dialog", { class: "assessment-dialog", "aria-labelledby": heading.id });
  const body = el("div");
  const alert = el("p", { role: "alert", class: "error" });
  const query = el("input", { type: "search" });
  let page = 0;
  let pending = false;

  function showList(): void {
    pending = false;
    onDraft(false);
    alert.textContent = "";
    const rows = repo
      .listAssessmentNotes()
      .filter((note) => scope === undefined || (scope.id === note.target.id && scope.kind === note.target.kind))
      .filter((note) =>
        [note.kind, note.target.label, note.text, note.responsible, note.currentState]
          .join(" ")
          .toLowerCase()
          .includes(query.value.trim().toLowerCase()),
      );
    const total = Math.max(1, Math.ceil(rows.length / 12));
    page = Math.min(page, total - 1);
    const list = el(
      "ul",
      {},
      ...rows.slice(page * 12, (page + 1) * 12).map((note) =>
        el(
          "li",
          {},
          el("h3", {}, `${note.kind} · ${note.currentState}`),
          el(
            "p",
            {},
            `${note.detached ? "Detached from " : ""}${note.target.label} · ${note.aspect} · ${note.marking}`,
          ),
          el("p", {}, note.text),
          note.kind === "Evidence"
            ? el("p", {}, [note.basis, note.finding, note.source, note.checkedOn].filter(Boolean).join(" · "))
            : null,
          note.resolution
            ? el("p", {}, `${note.kind === "Question" ? "Resolution recorded" : "Review response"}: ${note.resolution}`)
            : null,
          note.reviewedValue !== null ? el("p", {}, `Value at review: ${note.reviewedValue}`) : null,
          el(
            "div",
            { class: "actions" },
            button("Edit", () => {
              edit(note.kind, note);
            }),
            button("Delete", () => {
              if (!window.confirm("Delete this assessment note?")) return;
              repo.deleteAssessmentNote(note.id);
              showList();
              heading.focus();
            }),
          ),
        ),
      ),
    );
    const previous = button("Previous", () => {
      page--;
      showList();
      heading.focus();
    });
    const next = button("Next", () => {
      page++;
      showList();
      heading.focus();
    });
    previous.disabled = page === 0;
    next.disabled = page + 1 >= total;
    body.replaceChildren(
      el(
        "p",
        {},
        "Track findings, sources, and unresolved questions. Reviewed evidence applies to one assertion and value.",
      ),
      ...(scope ? [el("p", {}, scope.label)] : []),
      el("label", { class: "assessment-field" }, "Filter notes", query),
      ...(rows.length ? [list] : [el("p", {}, "No matching assessment notes.")]),
      el(
        "div",
        { class: "actions" },
        previous,
        next,
        button("Add evidence", () => {
          edit("Evidence");
        }),
        button("Add question", () => {
          edit("Question");
        }),
        button("Close", () => {
          dialog.close();
        }),
      ),
    );
  }

  function edit(kind: NoteKind, note?: ReadAssessmentNote): void {
    const defaultTarget = { kind: "assessment", id: null, label: "Assessment-level" } as const;
    const allTargets = repo.assessmentTargets();
    let selected = note?.target ?? scope ?? defaultTarget;
    const targetQuery = el("input", { type: "search" });
    const targets = el("select");
    const assertion = el("select");
    function refreshAssertions(wanted?: string) {
      assertion.replaceChildren(...ASSERTIONS[selected.kind].map((item) => option(item, item, item === wanted)));
    }
    function refreshTargets() {
      const needle = targetQuery.value.trim().toLowerCase();
      const filtered = allTargets
        .filter(
          (target) => target !== selected && target.id !== selected.id && target.label.toLowerCase().includes(needle),
        )
        .slice(0, 50);
      const offered = [selected, ...filtered];
      targets.replaceChildren(...offered.map((target, index) => option(String(index), target.label, index === 0)));
      targets.onchange = () => {
        selected = offered[Number(targets.value)] ?? defaultTarget;
        refreshTargets();
        refreshAssertions();
      };
    }
    targetQuery.addEventListener("input", refreshTargets);
    refreshTargets();
    refreshAssertions(note?.aspect);
    const text = el("textarea", { required: "", rows: "4", maxlength: "4000" });
    const source = el("input", { maxlength: "4000" });
    const responsible = el("input", { maxlength: "4000" });
    const checked = el("input", { type: "date" });
    const resolution = el("textarea", { rows: "3", maxlength: "4000" });
    text.value = note?.text ?? "";
    source.value = note?.source ?? "";
    responsible.value = note?.responsible ?? "";
    checked.value = note?.checkedOn ?? "";
    resolution.value = note?.resolution ?? "";
    const evidence = kind === "Evidence";
    const states = evidence ? REVIEW_STATES : (["open", "resolved"] as const);
    const state = el("select", {}, ...states.map((value) => option(value, value, value === note?.currentState)));
    const basis = el("select", {}, ...NOTE_BASES.map((value) => option(value, value, value === note?.basis)));
    const finding = el("select", {}, ...FINDINGS.map((value) => option(value, value, value === note?.finding)));
    const floor = MARKINGS.indexOf(repo.datasetMarking());
    const marking = el("select", {}, ...MARKINGS.slice(floor).map((value) => option(value, value)));
    const field = (label: string, input: HTMLElement) => el("label", { class: "assessment-field" }, label, input);
    const form = el(
      "form",
      {},
      el("h3", {}, note ? `Edit ${kind.toLowerCase()}` : `Add ${kind.toLowerCase()}`),
      field(kind === "Question" ? "Question or unresolved observation" : "Evidence details", text),
      field("Find a link (optional)", targetQuery),
      field("Linked record or assertion", targets),
      field("Assertion", assertion),
      field("Responsible assessor or team (optional)", responsible),
      field(evidence ? "Source label and locator (optional)" : "Next action (optional)", source),
      field("State", state),
      ...(evidence
        ? [field("Basis", basis), field("Finding", finding), field("Checked on", checked)]
        : [field("Resolution", resolution)]),
      field("Marking", marking),
      el(
        "div",
        { class: "actions" },
        button("Cancel", () => {
          if (!pending || window.confirm("Discard this unapplied assessment note?")) {
            showList();
            heading.focus();
          }
        }),
        el("button", { type: "submit" }, "Apply note"),
      ),
    );
    form.addEventListener("input", (event) => {
      if (event.target === targetQuery) return;
      pending = true;
      onDraft(true);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input: NoteInput = {
        kind,
        target: selected,
        aspect: assertion.value,
        text: text.value,
        source: source.value,
        responsible: responsible.value,
        checkedOn: checked.value,
        basis: basis.value as NoteInput["basis"],
        state: state.value as NoteInput["state"],
        finding: finding.value as NoteInput["finding"],
        marking: marking.value as Marking,
        resolution: resolution.value,
      };
      try {
        try {
          repo.saveAssessmentNote(input, note?.id);
        } catch (error) {
          if (!(error instanceof SensitiveInputWarning)) throw error;
          if (!window.confirm(error.message)) return;
          repo.saveAssessmentNote(input, note?.id, { confirmSensitive: true });
        }
        showList();
        heading.focus();
      } catch (error) {
        alert.textContent = error instanceof Error ? error.message : "Could not apply the assessment note.";
      }
    });
    body.replaceChildren(form);
    text.focus();
  }

  query.addEventListener("input", () => {
    page = 0;
    showList();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!pending || window.confirm("Discard this unapplied assessment note?")) dialog.close();
  });
  dialog.addEventListener(
    "close",
    () => {
      onDraft(false);
      dialog.remove();
      origin?.focus();
    },
    { once: true },
  );
  dialog.append(heading, alert, body);
  document.body.append(dialog);
  showList();
  dialog.showModal();
  heading.focus();
  return dialog;
}
