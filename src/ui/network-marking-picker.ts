import { MARKINGS, isMarking } from "../db/markings";
import { SensitiveInputWarning, ValidationError } from "../domain/errors";
import { MARKING_PRESETS, type CustomMarking, type NetworkMarking } from "../domain/network-marking-catalog";
import { markingSelectionValue, markingTextMatches, readMarkingSelection } from "../domain/network-markings";
import type { Repository } from "../domain/repository";
import { button, el, option } from "./dom";
import type { ReferencePicker } from "./reference-picker";

interface PickerContext {
  readonly repo: Repository;
  readonly trigger: HTMLButtonElement;
  readonly selected: string;
  readonly isCurrent: () => boolean;
  readonly onSelect: (value: string) => void;
  readonly onDraftChanged: () => void;
}

export function openNetworkMarkingPicker(ctx: PickerContext): ReferencePicker {
  const { repo, trigger } = ctx;
  let closed = false;
  let childDirty: (() => boolean) | undefined;
  const title = el("h2", {}, "Choose network marking");
  const dialog = el("dialog", { class: "network-marking-picker", "aria-label": "Choose network marking" });
  const query = el("input", {
    type: "search",
    "aria-label": "Search network markings",
    placeholder: "Search markings",
    autocomplete: "off",
  });
  const results = el("div", { class: "marking-results" });
  const status = el("p", { role: "status", class: "hint marking-status" });
  const browse = el("div", { class: "marking-browse" }, query, status, results);
  const child = el("div", { class: "marking-child" });
  child.hidden = true;
  const more = el("details", {}, el("summary", {}, "More markings"));
  const legacy = el("details", {}, el("summary", {}, "Legacy"));
  const custom = el("section", { "aria-label": "Custom markings" });
  const footer = el(
    "div",
    { class: "actions marking-picker-actions" },
    button("Create custom marking", () => {
      edit();
    }),
  );
  const selected = readMarkingSelection(ctx.selected);
  const preset = selected
    ? selected.source === "builtin"
      ? repo.getNetworkMarking(selected)
      : undefined
    : MARKING_PRESETS.find((entry) => entry.fullLabel === ctx.selected);
  if (preset)
    footer.append(
      button("Duplicate as custom", () => {
        edit(undefined, preset);
      }),
    );

  function choose(marking: NetworkMarking): void {
    if (!ctx.isCurrent() || !repo.getNetworkMarking(marking)) return;
    ctx.onSelect(markingSelectionValue(marking));
    close();
  }
  function close(): void {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
    ctx.onDraftChanged();
  }
  function back(): void {
    childDirty = undefined;
    child.hidden = true;
    child.replaceChildren();
    browse.hidden = false;
    footer.hidden = false;
    title.textContent = "Choose network marking";
    render();
    query.focus();
    ctx.onDraftChanged();
  }
  function edit(existing?: CustomMarking, copy?: NetworkMarking): void {
    if (!ctx.isCurrent()) return;
    browse.hidden = true;
    footer.hidden = true;
    child.hidden = false;
    title.textContent = existing ? "Edit custom marking" : "Create custom marking";
    const initial = existing ?? copy;
    const full = el("input", { id: "marking-full", type: "text", autocomplete: "off", required: "" });
    const short = el("input", { id: "marking-short", type: "text", autocomplete: "off", required: "" });
    const base = el(
      "select",
      { id: "marking-group", required: "" },
      option("", "Choose display grouping"),
      ...MARKINGS.map((marking) => option(marking, marking)),
    );
    const description = el("textarea", { id: "marking-description", rows: "2" });
    full.value = initial?.fullLabel ?? "";
    short.value = initial?.shortLabel ?? "";
    base.value = initial?.base ?? "";
    description.value = initial?.description ?? "";
    const impact = el("p", { class: "hint" });
    const feedback = el("p", { class: "message", role: "alert", tabindex: "-1" });
    const reuse = el("div", { class: "actions" });
    const removeChoice = el("div", { class: "actions" });
    const signature = () => JSON.stringify([full.value, short.value, base.value, description.value]);
    const before = signature();
    let confirmed: string | undefined;
    const usage = () => (existing ? repo.networkMarkingUsage(existing.key).length : 0);
    function updateImpact(): void {
      const count = usage();
      base.disabled = count > 0;
      impact.textContent = existing
        ? count > 0
          ? `Saving updates the label on ${String(count)} ${count === 1 ? "network" : "networks"}. Display grouping is fixed while in use.`
          : "No networks use this marking."
        : copy
          ? "Enter a distinct displayed marking to save your copy."
          : "Custom markings are saved to this dataset for reuse.";
    }
    const confirm = button("Save anyway", () => {
      save(true);
    });
    confirm.hidden = true;
    function save(allow: boolean): void {
      if (!ctx.isCurrent() || (allow && confirmed !== signature())) return;
      if (!isMarking(base.value)) {
        feedback.textContent = "Choose a display grouping.";
        base.focus();
        return;
      }
      const current = existing && repo.getNetworkMarking(existing);
      if (existing && JSON.stringify(existing) !== JSON.stringify(current)) {
        feedback.textContent = "This shared marking changed. Reopen it to review the current values.";
        return;
      }
      try {
        const saved = repo.saveCustomNetworkMarking(
          {
            fullLabel: full.value,
            shortLabel: short.value,
            base: base.value,
            description: description.value,
          },
          { confirmSensitive: allow },
          existing?.key,
        );
        if (existing) back();
        else choose(saved);
      } catch (error) {
        feedback.textContent = error instanceof Error ? error.message : String(error);
        if (error instanceof SensitiveInputWarning) {
          confirmed = signature();
          confirm.hidden = false;
        }
        if (error instanceof ValidationError) {
          if (error.code === "DUPLICATE" && !existing) {
            const match = repo.findMatchingNetworkMarking(full.value);
            if (match)
              reuse.replaceChildren(
                button(`Use existing ${match.fullLabel}`, () => {
                  choose(match);
                }),
              );
          }
          const field = new Map<string, HTMLElement>([
            ["Displayed marking", full],
            ["Short map label", short],
            ["Description", description],
            ["Display grouping", base],
          ]);
          (field.get(error.field) ?? feedback).focus();
        } else feedback.focus();
      }
    }
    function deleteMarking(): void {
      if (!existing || !ctx.isCurrent()) return;
      try {
        repo.deleteCustomNetworkMarking(existing.key);
        back();
      } catch (error) {
        feedback.textContent = error instanceof Error ? error.message : String(error);
        feedback.focus();
        updateImpact();
      }
    }

    const form = el(
      "form",
      { novalidate: "" },
      el("div", { class: "field" }, el("label", { for: full.id }, "Displayed marking"), full),
      el(
        "div",
        { class: "field" },
        el("label", { for: short.id }, "Short map label"),
        short,
        el("p", { class: "hint" }, "Up to 20 characters."),
      ),
      el(
        "div",
        { class: "field" },
        el("label", { for: base.id }, "Display grouping"),
        base,
        el("p", { class: "hint" }, "Existing diagram and banner grouping."),
      ),
      el("div", { class: "field" }, el("label", { for: description.id }, "Description"), description),
      impact,
      feedback,
      reuse,
      el(
        "div",
        { class: "actions" },
        el("button", { type: "submit", class: "primary" }, existing ? "Save custom marking" : "Create and use"),
        confirm,
        button("Cancel", back),
      ),
      removeChoice,
    );
    if (existing) {
      const remove = button("Delete custom marking", () => {
        if (usage()) {
          deleteMarking();
          return;
        }
        const confirmDelete = button("Confirm delete", deleteMarking);
        removeChoice.replaceChildren(
          confirmDelete,
          button("Keep marking", () => {
            removeChoice.replaceChildren(remove);
            remove.focus();
          }),
        );
        confirmDelete.focus();
      });
      removeChoice.append(remove);
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      save(false);
    });
    form.addEventListener("input", () => {
      confirm.hidden = true;
      confirmed = undefined;
      feedback.textContent = "";
      reuse.replaceChildren();
      ctx.onDraftChanged();
    });
    childDirty = () => before !== signature();
    updateImpact();
    child.append(form);
    full.focus();
    ctx.onDraftChanged();
  }

  function choiceRow(marking: NetworkMarking, concise = false): HTMLElement {
    const selected =
      markingSelectionValue(marking) === ctx.selected ||
      (marking.source === "builtin" && marking.fullLabel === ctx.selected);
    const row = button(
      marking.fullLabel,
      () => {
        choose(marking);
      },
      {
        class: "picker-option marking-choice",
        "aria-label": marking.fullLabel,
        "aria-pressed": String(selected),
        "data-marking-choice": "",
      },
    );
    const delimiter = marking.fullLabel.indexOf("//");
    if (concise && delimiter >= 0) {
      row.replaceChildren(
        el("span", {}, marking.fullLabel.slice(0, delimiter + 2), el("wbr"), marking.fullLabel.slice(delimiter + 2)),
      );
    }
    if (!concise && marking.description) {
      const detail = el("small", { class: "picker-option-detail" }, marking.description);
      row.append(detail);
    }
    return el(
      "li",
      { class: "marking-option-row" },
      row,
      marking.source === "custom"
        ? button(
            "Edit",
            () => {
              edit(marking);
            },
            { "aria-label": `Edit custom marking ${marking.fullLabel}` },
          )
        : null,
    );
  }
  function setDisclosure(group: HTMLDetailsElement, options: readonly NetworkMarking[]): void {
    group.querySelector("ul")?.remove();
    group.hidden = options.length === 0;
    if (options.length) group.append(el("ul", {}, ...options.map((entry) => choiceRow(entry))));
  }
  function render(): void {
    if (closed || !child.hidden) return;
    const search = query.value.trim();
    const presets = MARKING_PRESETS.filter((entry) => markingTextMatches(entry, search));
    const quick = presets.filter((entry) => entry.section === "quick");
    const moreMarkings = presets.filter((entry) => entry.section === "more");
    const legacyMarkings = presets.filter((entry) => entry.section === "legacy");
    const customs = repo.listCustomNetworkMarkings().filter((entry) => markingTextMatches(entry, search));
    setDisclosure(more, moreMarkings);
    setDisclosure(legacy, legacyMarkings);
    custom.hidden = customs.length === 0;
    if (customs.length)
      custom.replaceChildren(
        el("h3", {}, "Custom markings"),
        el("ul", {}, ...customs.map((entry) => choiceRow(entry))),
      );
    results.replaceChildren(
      ...(quick.length
        ? [
            el(
              "section",
              { "aria-label": "Quick picks" },
              el("h3", {}, "Quick picks"),
              el("ul", { class: "marking-quick-picks" }, ...quick.map((entry) => choiceRow(entry, !search))),
            ),
          ]
        : []),
      custom,
      more,
      legacy,
    );
    status.textContent = search ? `${String(presets.length + customs.length)} matching markings` : "";
  }

  query.addEventListener("input", () => {
    more.open = query.value.trim() !== "";
    legacy.open = more.open;
    render();
  });
  browse.addEventListener("keydown", (event) => {
    const choices = [...results.querySelectorAll<HTMLButtonElement>("[data-marking-choice]")].filter(
      (element) => element.getClientRects().length > 0,
    );
    const index = choices.findIndex((element) => element === document.activeElement);
    if (document.activeElement !== query && index < 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      choices[Math.min(index + 1, choices.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      (index === -1 ? choices.at(-1) : index === 0 ? query : choices[index - 1])?.focus();
    } else if (event.key === "Enter" && document.activeElement === query) {
      event.preventDefault();
      choices[0]?.click();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (child.hidden) close();
    else back();
  });
  dialog.append(
    el("header", { class: "picker-header" }, title, button("Close", close, { "aria-label": "Close picker" })),
    browse,
    footer,
    child,
  );
  document.body.append(dialog);
  render();
  dialog.showModal();
  query.focus();
  return {
    close,
    refresh: render,
    hasPendingDraft: () => !closed && (childDirty?.() ?? false),
    revealPendingDraft: () => child.querySelector("input")?.focus(),
  };
}
