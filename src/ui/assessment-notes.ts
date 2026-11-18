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
import { assessmentPanel } from "./assessment-panel";
import { resolveNoteTarget } from "../assessment/note-target";

export interface NoteListPosition {
  query: string;
  kind: string;
  state: string;
  page: number;
  scroll: number;
  noteId: string | null;
}

export interface NoteNavigation {
  position?: NoteListPosition;
  recordedPerspective?: boolean;
  inspect: (target: NoteTarget, position: NoteListPosition, aspect: string) => Promise<boolean>;
}

export function mountAssessmentNotes(
  host: HTMLElement,
  repo: Repository,
  onDraft: (pending: boolean) => void,
  scope: NoteTarget | undefined,
  navigation: NoteNavigation,
  onClose: () => void,
) {
  const heading = el("h2", { id: "assessment-notes-heading", tabindex: "-1" }, "Assessment evidence and questions");
  const container = el("section", { class: "assessment-note-inspector", "aria-labelledby": heading.id });
  const body = el("div");
  const alert = el("p", { role: "alert", class: "error" });
  const query = el("input", { type: "search" });
  const kindFilter = el("select", {}, ...["All types", "Evidence", "Question"].map((value) => option(value, value)));
  const stateFilter = el(
    "select",
    {},
    ...["All states", "open", "resolved", ...REVIEW_STATES].map((value) => option(value, value)),
  );
  const status = el("p", { role: "status", class: "assessment-note-meta" });
  const results = el("div");
  const resume = navigation.position;
  query.value = resume?.query ?? "";
  kindFilter.value = resume?.kind ?? "All types";
  stateFilter.value = resume?.state ?? "All states";
  let page = resume?.page ?? 0;
  let pending = false;
  let composer: HTMLDialogElement | null = null;
  let lastNoteId = resume?.noteId ?? null;
  let navigationPending = false;
  let notes: ReadAssessmentNote[] = [];
  let targetLabels = new Map<string, string>();
  function readCurrent(): void {
    notes = repo.listAssessmentNotes();
    targetLabels = new Map(
      repo.assessmentTargets().map((target) => [`${target.kind}:${target.id ?? ""}`, target.label]),
    );
  }
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
        { class: "assessment-note-filters" },
        el("label", { class: "assessment-field" }, "Note type", kindFilter),
        el("label", { class: "assessment-field" }, "Note state", stateFilter),
      ),
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
    readCurrent();
    refreshResults();
  }

  function refreshResults(): void {
    const needle = query.value.trim().toLowerCase();
    const labelFor = (note: ReadAssessmentNote) =>
      targetLabels.get(`${note.target.kind}:${note.target.id ?? ""}`) ?? note.target.label;
    const rows = notes
      .filter((note) => scope === undefined || (scope.id === note.target.id && scope.kind === note.target.kind))
      .filter(
        (note) =>
          (kindFilter.value === "All types" || note.kind === kindFilter.value) &&
          (stateFilter.value === "All states" || note.currentState === stateFilter.value),
      )
      .filter((note) =>
        [note.kind, labelFor(note), note.aspect, note.text, note.responsible, note.source, note.currentState]
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
      status.textContent =
        needle || kindFilter.value !== "All types" || stateFilter.value !== "All states"
          ? "No matching assessment notes."
          : "No evidence or questions recorded.";
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
          { "data-kind": note.kind, "data-note-id": note.id },
          el("h3", {}, note.kind, " · ", el("span", { class: "note-state" }, note.currentState)),
          el(
            "p",
            { class: "assessment-note-target" },
            `${note.detached ? "Detached from " : ""}${labelFor(note)} · ${note.aspect} · ${note.marking}`,
          ),
          el("p", { class: "assessment-note-text" }, note.text),
          note.kind === "Evidence"
            ? el(
                "p",
                { class: "assessment-note-meta" },
                [note.basis, note.finding, note.source, note.checkedOn].filter(Boolean).join(" · "),
              )
            : el(
                "dl",
                { class: "question-follow-up" },
                el("dt", {}, "Responsible team"),
                el("dd", {}, note.responsible || "No responsible team set"),
                el("dt", {}, "Next action"),
                el("dd", {}, note.source || "No next action recorded"),
              ),
          note.resolution
            ? el("p", {}, `${note.kind === "Question" ? "Resolution recorded" : "Review response"}: ${note.resolution}`)
            : null,
          note.reviewedValue !== null ? el("p", {}, `Value at review: ${note.reviewedValue}`) : null,
          el(
            "div",
            { class: "actions" },
            !note.detached
              ? button(
                  navigation.recordedPerspective === false
                    ? "Inspect recorded assertion in As-Is"
                    : "Inspect linked assertion",
                  () => {
                    void inspect(note);
                  },
                  {
                    "data-note-target": note.id,
                    "aria-label": `Inspect ${labelFor(note)} · ${note.aspect}${navigation.recordedPerspective === false ? " in As-Is" : ""}`,
                  },
                )
              : null,
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

  function position(): NoteListPosition {
    return {
      query: query.value,
      kind: kindFilter.value,
      state: stateFilter.value,
      page,
      scroll: panel.body.scrollTop,
      noteId: lastNoteId,
    };
  }
  async function inspect(note: ReadAssessmentNote): Promise<void> {
    if (navigationPending) return;
    const current = repo.listAssessmentNotes().find((row) => row.id === note.id);
    if (
      !current ||
      current.target.kind !== note.target.kind ||
      current.target.id !== note.target.id ||
      !resolveNoteTarget(repo, current.target)
    ) {
      readCurrent();
      refreshResults();
      alert.textContent = "This assertion is no longer available. The note retains its original context.";
      heading.focus();
      return;
    }
    lastNoteId = note.id;
    navigationPending = true;
    try {
      await navigation.inspect(current.target, position(), current.aspect);
    } catch (error) {
      alert.textContent = error instanceof Error ? error.message : "Could not inspect this assertion.";
    } finally {
      navigationPending = false;
    }
  }

  function edit(kind: NoteKind, note?: ReadAssessmentNote): void {
    const scroll = panel.body.scrollTop;
    const resumeList = (): void => {
      if (composer) {
        composer.close();
        composer.remove();
        composer = null;
      }
      panel.body.prepend(alert);
      showList();
      const opener = body.querySelector<HTMLElement>(`[data-note-origin="${CSS.escape(note?.id ?? kind)}"]`);
      (opener ?? query).focus({ preventScroll: true });
      panel.body.scrollTop = scroll;
    };
    const back = (): void => {
      if (!pending || window.confirm("Discard this unapplied assessment note?")) resumeList();
    };
    const defaultTarget = { kind: "assessment", id: null, label: "Assessment-level" } as const;
    const allTargets = repo.assessmentTargets();
    const original = note?.target ?? scope ?? defaultTarget;
    let selected = allTargets.find((target) => target.kind === original.kind && target.id === original.id) ?? original;
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
          (target) =>
            (target.kind !== selected.kind || target.id !== selected.id) && target.label.toLowerCase().includes(needle),
        )
        .slice(0, 50);
      const offered = [selected, ...filtered];
      targets.replaceChildren(
        ...offered.map((target, index) =>
          option(
            String(index),
            note?.detached && target.id === note.target.id && target.kind === note.target.kind
              ? `Detached · ${target.label}`
              : target.label,
            index === 0,
          ),
        ),
      );
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
    const label = note ? `Edit ${kind.toLowerCase()}` : `Add ${kind.toLowerCase()}`;
    composer = el("dialog", { class: "assessment-dialog", "aria-label": label });
    const editPanel = assessmentPanel(composer, el("h2", {}, label), back, alert, form);
    editPanel.setBack("Back to notes", back);
    composer.addEventListener("cancel", editPanel.cancel);
    document.body.append(composer);
    composer.showModal();
    text.focus();
  }

  const filter = () => {
    page = 0;
    refreshResults();
  };
  query.addEventListener("input", filter);
  kindFilter.addEventListener("change", filter);
  stateFilter.addEventListener("change", filter);
  function dispose(): void {
    unsubscribe();
    composer?.close();
    composer?.remove();
    composer = null;
    container.remove();
    pending = false;
    onDraft(false);
  }
  function close(): boolean {
    if (pending && !window.confirm("Discard this unapplied assessment note?")) return false;
    onClose();
    return true;
  }
  const panel = assessmentPanel(container, heading, close, alert, body);
  host.append(container);
  showList();
  const unsubscribe = repo.subscribe((change) => {
    if (composer || change.entity === "position") return;
    const active = document.activeElement;
    const button = active instanceof HTMLButtonElement && results.contains(active) ? active : null;
    const id = button?.closest<HTMLElement>("[data-note-id]")?.dataset["noteId"];
    const scroll = panel.body.scrollTop;
    readCurrent();
    refreshResults();
    if (button && id) {
      const row = results.querySelector(`[data-note-id="${CSS.escape(id)}"]`);
      const replacement = [...(row?.querySelectorAll("button") ?? [])].find(
        (control) => control.textContent === button.textContent,
      );
      (replacement ?? query).focus({ preventScroll: true });
    }
    panel.body.scrollTop = scroll;
  });
  const focus = () => {
    const origin = lastNoteId
      ? results.querySelector<HTMLElement>(`[data-note-target="${CSS.escape(lastNoteId)}"]`)
      : null;
    (origin ?? heading).focus({ preventScroll: true });
    panel.body.scrollTop = resume?.scroll ?? 0;
  };
  return { close, dispose, position, focus, hasDraft: () => pending };
}
