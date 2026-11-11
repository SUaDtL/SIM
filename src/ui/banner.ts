import { bannerText, type Marking } from "../db/markings";
import { el } from "./dom";

export interface Banner {
  /** First child of the app: the only one announced to screen readers. */
  readonly top: HTMLElement;
  /** Last child of the app: the same banner, hidden from screen readers. */
  readonly bottom: HTMLElement;
  /** Show the highest marking present and the dataset caveat (security-controls CON-002). */
  update(marking: Marking, caveat: string | null): void;
}

/**
 * The classification banner at the top and bottom of the app. Colors come from `data-marking` in
 * CSS. Text is set with textContent, and only when it changes, so saving positions after a drag
 * does not make a screen reader repeat it.
 */
export function createBanner(): Banner {
  const top = el("div", { class: "classification-banner", "data-testid": "banner-top", role: "status" });
  const bottom = el("div", { class: "classification-banner", "data-testid": "banner-bottom", "aria-hidden": "true" });
  return {
    top,
    bottom,
    update(marking, caveat) {
      const text = bannerText(marking, caveat);
      for (const banner of [top, bottom]) {
        if (banner.textContent === text && banner.dataset["marking"] === marking) continue;
        banner.textContent = text;
        banner.dataset["marking"] = marking;
      }
    },
  };
}
