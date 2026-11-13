import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MARKINGS } from "../db/markings";
import { BANNER_COLORS, bandHeight, layoutFrame } from "./export";

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

  it("wraps long context and legend without reducing the map rectangle", () => {
    const frame = layoutFrame(
      800,
      {
        title: "A very long synthetic dataset title repeated again and again for a narrow capture",
        details: ["Compare: a long fictional scenario name with many words"],
        legend: ["Depends on: consumer → provider; this is a dependency model, not measured traffic"],
      },
      (text, size) => text.length * size,
    );
    expect(frame.topLines.length).toBeGreaterThan(2);
    expect(frame.bottomLines.length).toBeGreaterThan(1);
    expect(frame.topLines.every((line) => line.text.length * line.size <= 760)).toBe(true);
    expect(frame.bottomLines.every((line) => line.text.length * line.size <= 760)).toBe(true);
    expect(frame.topHeight).toBeGreaterThan(frame.topLines.at(-1)?.y ?? 0);
    expect(frame.bottomHeight).toBeGreaterThan(frame.bottomLines.at(-1)?.y ?? 0);
  });

  it.each([
    [2400, 1400],
    [3600, 900],
    [1600, 2400],
  ])("keeps detached capture annotations readable when %ix%i is fitted to a 1280x720 slide", (width, height) => {
    const frame = layoutFrame(
      width,
      {
        title: "Synthetic decision review / Network connections",
        details: [
          "Focused network: Coral",
          "1 foundational dependency hidden",
          "Committed document has unsaved changes",
        ],
        legend: [
          "Depends on: consumer → provider",
          "Cross-network dependency, no CDS recorded",
          "Recorded dependencies; connectivity is not verified",
        ],
      },
      (text, size) => text.length * size * 0.6,
      height,
    );
    const band = frame.bandHeight ?? bandHeight(width);
    const fit = Math.min(1280 / width, 720 / (height + frame.topHeight + frame.bottomHeight + 2 * band));
    expect(Math.min(...frame.bottomLines.map((line) => line.size)) * fit).toBeGreaterThanOrEqual(11.9);
    expect(frame.topLines.every((line) => line.text.length * line.size * 0.6 <= width * 0.95)).toBe(true);
    expect(frame.bottomLines.every((line) => line.text.length * line.size * 0.6 <= width * 0.95)).toBe(true);
  });
});
