type Child = Node | string | null | undefined | false;

/**
 * Create an element with attributes and children. Text children become text nodes, so values from the
 * dataset are never parsed as HTML (security-controls FACT-002).
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function button(label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = el("button", { type: "button", ...attrs }, label);
  b.addEventListener("click", () => {
    // A queued action from a disposed inspector or dataset cannot target the replacement.
    if (b.isConnected) onClick();
  });
  return b;
}

export function option(value: string, label: string, selected = false): HTMLOptionElement {
  const o = el("option", { value }, label);
  o.selected = selected;
  return o;
}

/** Preserve paging focus when the activated control becomes disabled at a boundary. */
export function focusPagingControl(preferred: HTMLButtonElement, alternative: HTMLButtonElement): void {
  if (!preferred.disabled) preferred.focus();
  else if (!alternative.disabled) alternative.focus();
}
