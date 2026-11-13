import { button, el } from "./dom";

export interface PickerOption {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
}

export interface ReferencePickerOptions {
  readonly label: string;
  readonly options: () => readonly PickerOption[];
  readonly selectedValue?: string;
  readonly allowNone?: boolean;
  readonly onSelect: (value: string) => void;
  readonly isCurrent?: () => boolean;
  readonly returnFocus: HTMLElement;
  /** The child uses the normal validated write path. No write happens merely by opening it. */
  readonly create?: (query: string, complete: (value: string) => void, back: () => void) => HTMLElement;
}

export interface ReferencePicker {
  close(): void;
  refresh(): void;
}

/** Discovery is pure and preserves caller order and identity, including duplicate display names. */
export function pickerPage(options: readonly PickerOption[], query: string, requestedPage: number) {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(needle))
    : options;
  const pageCount = Math.max(1, Math.ceil(matches.length / 20));
  const requested = Number.isFinite(requestedPage) ? Math.max(0, Math.floor(requestedPage)) : 0;
  const page = Math.min(requested, pageCount - 1);
  return { items: matches.slice(page * 20, page * 20 + 20), page, pageCount, total: matches.length };
}

/** One bounded, searchable selection dialog. A highlighted or blurred candidate never assigns. */
export function openReferencePicker(ctx: ReferencePickerOptions): ReferencePicker {
  let closed = false;
  let page = 0;
  let inChild = false;
  const query = el("input", {
    type: "search",
    "aria-label": `Search ${ctx.label}`,
    placeholder: `Search ${ctx.label}`,
    autocomplete: "off",
    "data-testid": "picker-query",
  });
  const results = el("ul", { class: "picker-results", "data-testid": "picker-results" });
  const count = el("p", { class: "hint", role: "status", "data-testid": "picker-count" });
  const message = el("p", { class: "hint", role: "status", "data-testid": "picker-message" });
  const child = el("div", { class: "picker-child", "data-testid": "picker-child" });
  child.hidden = true;
  const searchBody = el("div", { class: "picker-search" }, query, results, count);
  const dialog = el("dialog", {
    class: "reference-picker",
    "aria-label": `Choose ${ctx.label}`,
    "data-testid": "record-picker",
  });

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (ctx.returnFocus.isConnected) ctx.returnFocus.focus({ preventScroll: true });
    else if (ctx.returnFocus.id && (ctx.isCurrent?.() ?? true)) {
      document.getElementById(ctx.returnFocus.id)?.focus({ preventScroll: true });
    }
  };
  const current = (): boolean => {
    if (closed) return false;
    if (ctx.isCurrent?.() ?? true) return true;
    message.textContent = "The dataset or parent task changed. Close this picker and reopen it from the current task.";
    return false;
  };
  const choose = (value: string): void => {
    if (!current()) return;
    if ((value === "" && !ctx.allowNone) || (value !== "" && !ctx.options().some((item) => item.value === value))) {
      message.textContent = "That record is no longer available. Search for another record.";
      if (!inChild) render();
      return;
    }
    ctx.onSelect(value);
    close();
  };
  const previous = button("Previous results", () => {
    page--;
    render();
    results.querySelector<HTMLButtonElement>("button")?.focus();
  });
  const next = button("Next results", () => {
    page++;
    render();
    results.querySelector<HTMLButtonElement>("button")?.focus();
  });
  const pagination = el("div", { class: "picker-pagination actions" }, previous, next);
  searchBody.append(pagination);

  const back = (): void => {
    if (closed) return;
    inChild = false;
    child.replaceChildren();
    child.hidden = true;
    searchBody.hidden = false;
    create.hidden = ctx.create === undefined;
    render();
    query.focus();
  };
  const create = button(`Create new ${ctx.label}`, () => {
    if (!ctx.create || !current() || inChild) return;
    inChild = true;
    searchBody.hidden = true;
    create.hidden = true;
    child.hidden = false;
    child.replaceChildren(
      button("Back to existing records", back, { class: "subtle" }),
      el("p", { class: "hint" }, "This shared record remains available if you later cancel the parent task."),
      ctx.create(query.value, choose, back),
    );
    child.querySelector<HTMLElement>("input, select, textarea")?.focus();
  });
  create.hidden = ctx.create === undefined;

  function render(): void {
    if (closed || inChild) return;
    const available = ctx.options().filter((item) => item.value !== "");
    const discovered = pickerPage(available, query.value, page);
    page = discovered.page;
    const rows = discovered.items.map((item) => {
      const select = button(
        "",
        () => {
          choose(item.value);
        },
        {
          class: "picker-option",
          "data-picker-value": item.value,
          ...(item.value === ctx.selectedValue ? { "aria-current": "true" } : {}),
        },
      );
      select.append(el("span", { class: "picker-option-name" }, item.label));
      if (item.detail) select.append(el("small", { class: "picker-option-detail" }, item.detail));
      return el("li", {}, select);
    });
    if (ctx.allowNone)
      rows.unshift(
        el(
          "li",
          {},
          button(
            "No assignment",
            () => {
              choose("");
            },
            { "data-picker-value": "" },
          ),
        ),
      );
    if (discovered.total === 0)
      rows.push(el("li", { class: "empty" }, "No matching records. Try another name or create one."));
    results.replaceChildren(...rows);
    count.textContent =
      discovered.total === 0
        ? "0 matching records."
        : `Showing ${String(page * 20 + 1)}-${String(Math.min((page + 1) * 20, discovered.total))} of ${String(discovered.total)} matching records.`;
    previous.disabled = page === 0;
    next.disabled = page + 1 >= discovered.pageCount;
    pagination.hidden = discovered.pageCount === 1;
    if (ctx.selectedValue && !available.some((item) => item.value === ctx.selectedValue)) {
      message.textContent =
        "The selected record is no longer available. Choose a replacement; no new assignment has been made.";
    }
    if (!current()) {
      for (const control of results.querySelectorAll<HTMLButtonElement>("button")) control.disabled = true;
      create.disabled = true;
    }
  }

  query.addEventListener("input", () => {
    page = 0;
    message.textContent = "";
    render();
  });
  query.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = results.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    (event.key === "ArrowDown" ? buttons[0] : buttons[buttons.length - 1])?.focus();
  });
  results.addEventListener("keydown", (event) => {
    const buttons = [...results.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? buttons[0] : buttons.at(-1))?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) query.focus();
      else buttons[index - 1]?.focus();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.append(
    el("header", { class: "picker-header" }, el("h2", {}, `Choose ${ctx.label}`), button("Close picker", close)),
    message,
    searchBody,
    create,
    child,
  );
  document.body.append(dialog);
  render();
  dialog.showModal();
  query.focus();
  return { close, refresh: render };
}
