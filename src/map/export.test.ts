import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MARKINGS } from "../db/markings";
import { BANNER_COLORS, bandHeight } from "./export";

const css = readFileSync(new URL("../ui/app.css", import.meta.url), "utf8");

/** The background and text color the app banner's CSS gives a marking (UNCLASSIFIED is the base rule). */
function cssColors(marking: string): { background: string; text: string } {
  const base = /\.classification-banner \{([^}]*)\}/.exec(css)?.[1] ?? "";
  const rule = /\.classification-banner\[data-marking="([^"]+)"\] \{([^}]*)\}/g;
  let own = "";
  for (const m of css.matchAll(rule)) if (m[1] === marking) own = m[2] ?? "";
  const pick = (block: string, prop: string) => new RegExp(`(?:^|\\s)${prop}:\\s*(#[0-9a-f]{6})`).exec(block)?.[1];
  return {
    background: pick(own, "background") ?? pick(base, "background") ?? "",
    text: pick(own, "color") ?? pick(base, "color") ?? "",
  };
}

describe("export banner", () => {
  it.each(MARKINGS)("uses the app banner's colors for %s", (marking) => {
    expect(BANNER_COLORS[marking]).toEqual(cssColors(marking));
  });

  it("scales the banner band with the image and keeps it readable", () => {
    expect(bandHeight(400)).toBe(28);
    expect(bandHeight(3200)).toBe(80);
  });
});
