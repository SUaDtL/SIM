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
import { button, el, focusPagingControl, option } from "./dom";
import { assessmentOpener, assessmentPanel } from "./assessment-panel";

export function openAssessmentNotes(repo: Repository, onDraft: (pending: boolean) => void, scope?: NoteTarget) {
  const origin = assessmentOpener();
  const originPanel = origin?.closest<HTMLElement>('dialog, [data-testid="editor"]');
  const serviceIdentity = origin?.dataset["serviceEvidence"];
  const heading = el("h2", { id: "assessment-notes-heading", tabindex: "-1" }, "Assessment evidence and questions");
  const dialog = el("dialog", { class: "assessment-dialog", "aria-labelledby": heading.id });
  const body = el("div");
  const alert = el("p", { role: "alert", class: "error" });
  const query = el("input", { type: "search" });
  const status = el("p", { role: "status", class: "assessment-note-meta" });
  const results = el("div");
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

  function showList(): void {
    panel.setBack("", null);
    pending = false;
    onDraft(false);
    alert.textContent = "";
    body.replaceChildren(
      el(
        "p",
        {},
        scope
          ? `Record evidence or an open question about ${scope.label}.`
          : "Keep the evidence behind an assessment alongside the questions that still need an answer. Link either to a specific record or the whole assessment.",
      ),
      el("label", { class: "assessment-field" }, "Filter notes", query),
      el(
        "div",
        { class: "actions reading-tools" },
        button(
          "Add evidence",
          () => {
            edit("Evidence");
          },
          { "data-note-origin": "Evidence" },
        ),
        button(
          "Add question",
          () => {
            edit("Question");
          },
          { "data-note-origin": "Question" },
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
    const rows = repo
      .listAssessmentNotes()
      .filter((note) => scope === undefined || (scope.id === note.target.id && scope.kind === note.target.kind))
      .filter((note) =>
        [note.kind, note.target.label, note.aspect, note.text, note.responsible, note.source, note.currentState]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    const total = Math.max(1, Math.ceil(rows.length / 12));
    page = Math.min(page, total - 1);
    previous.disabled = page === 0;
    next.disabled = page + 1 >= total;
    previous.hidden = next.hidden = total === 1;
    if (!rows.length) {
      status.textContent = needle ? "No matching assessment notes." : "No evidence or questions recorded.";
      results.replaceChildren();
      return;
    }
    const first = page * 12 + 1;
    const last = Math.min(first + 11, rows.length);
    const range = last === first ? String(first) : `${String(first)}–${String(last)}`;
    const count = total === 1 ? String(rows.length) : `${range} of ${String(rows.length)}`;
    status.textContent = `${count} ${needle ? "matching " : ""}${rows.length === 1 ? "note" : "notes"}`;
    const list = el(
      "ul",
      { class: "assessment-note-list" },
      ...rows.slice(page * 12, (page + 1) * 12).map((note) =>
        el(
          "li",
          { "data-kind": note.kind },
          el("h3", {}, note.kind, " · ", el("span", { class: "note-state" }, note.currentState)),
          el(
            "p",
            { class: "assessment-note-target" },
            `${note.detached ? "Detached from " : ""}${note.target.label} · ${note.aspect} · ${note.marking}`,
          ),
          el("p", { class: "assessment-note-text" }, note.text),
          note.kind === "Evidence"
            ? el(
                "p",
                { class: "assessment-note-meta" },
                [note.basis, note.finding, note.source, note.checkedOn].filter(Boolean).join(" · "),
              )
            : null,
          note.resolution
            ? el("p", {}, `${note.kind === "Question" ? "Resolution recorded" : "Review response"}: ${note.resolution}`)
            : null,
          note.reviewedValue !== null ? el("p", {}, `Value at review: ${note.reviewedValue}`) : null,
          el(
            "div",
            { class: "actions" },
            button(
              "Edit",
              () => {
                edit(note.kind, note);
              },
              { "data-note-origin": note.id },
            ),
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
    results.replaceChildren(list);
  }

  function edit(kind: NoteKind, note?: ReadAssessmentNote): void {
    const scroll = panel.body.scrollTop;
    const resumeList = (): void => {
      showList();
      const opener = body.querySelector<HTMLElement>(`[data-note-origin="${CSS.escape(note?.id ?? kind)}"]`);
      (opener ?? query).focus({ preventScroll: true });
      panel.body.scrollTop = scroll;
    };
    const back = (): void => {
      if (!pending || window.confirm("Discard this unapplied assessment note?")) resumeList();
    };
    panel.setBack("Back to notes", back);
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
      el("div", { class: "actions" }, button("Cancel", back), el("button", { type: "submit" }, "Apply note")),
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
        resumeList();
      } catch (error) {
        alert.textContent = error instanceof Error ? error.message : "Could not apply the assessment note.";
      }
    });
    body.replaceChildren(form);
    text.focus();
  }

  query.addEventListener("input", () => {
    page = 0;
    refreshResults();
  });
  function close(): void {
    if (!pending || window.confirm("Discard this unapplied assessment note?")) dialog.close();
  }
  dialog.addEventListener(
    "close",
    () => {
      onDraft(false);
      dialog.remove();
      const returnTo = origin?.isConnected
        ? origin
        : serviceIdentity
          ? originPanel?.querySelector<HTMLElement>(`[data-service-evidence="${CSS.escape(serviceIdentity)}"]`)
          : origin?.id
            ? document.getElementById(origin.id)
            : null;
      returnTo?.focus();
    },
    { once: true },
  );
  const panel = assessmentPanel(dialog, heading, close, alert, body);
  dialog.addEventListener("cancel", panel.cancel);
  document.body.append(dialog);
  showList();
  dialog.showModal();
  heading.focus();
  return dialog;
}
