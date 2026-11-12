import { bannerText, type Marking } from "../db/markings";

/**
 * Banner colors for exports, matching the app banner's CSS (an e2e test compares the two). Colors
 * follow the SF-70x label convention; TOP SECRET uses dark text for contrast.
 */
export const BANNER_COLORS: Record<Marking, { readonly background: string; readonly text: string }> = {
  UNCLASSIFIED: { background: "#007a33", text: "#ffffff" },
  CUI: { background: "#502b85", text: "#ffffff" },
  CONFIDENTIAL: { background: "#0033a0", text: "#ffffff" },
  SECRET: { background: "#c8102e", text: "#ffffff" },
  "TOP SECRET": { background: "#ff671f", text: "#000000" },
};

/** Banner band height for an image of this width: readable on a slide, never tiny. */
export const bandHeight = (width: number): number => Math.max(28, Math.round(width * 0.025));

export interface FrameContent {
  readonly title: string;
  readonly details: readonly string[];
  readonly legend: readonly string[];
}

export interface FrameLine {
  readonly text: string;
  readonly y: number;
  readonly size: number;
  readonly bold: boolean;
}

export interface FrameLayout {
  readonly topHeight: number;
  readonly bottomHeight: number;
  readonly topLines: readonly FrameLine[];
  readonly bottomLines: readonly FrameLine[];
}

/** Shared PNG/SVG frame geometry, with text wrapped within the captured viewport width. */
export function layoutFrame(
  width: number,
  content: FrameContent,
  measure: (text: string, size: number, bold: boolean) => number = (text, size) => text.length * size * 0.6,
): FrameLayout {
  const pad = Math.max(16, Math.round(width * 0.025));
  const maxWidth = Math.max(1, width - 2 * pad);
  const wrap = (source: string, size: number, bold: boolean): string[] => {
    const result: string[] = [];
    let line = "";
    for (const word of source.split(/\s+/)) {
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size, bold) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) result.push(line);
      line = "";
      for (const char of word) {
        if (line && measure(line + char, size, bold) > maxWidth) {
          result.push(line);
          line = "";
        }
        line += char;
      }
    }
    if (line) result.push(line);
    return result;
  };
  const rows = (entries: readonly { text: string; size: number; bold: boolean }[]) => {
    const lines: FrameLine[] = [];
    let y = pad;
    for (const entry of entries) {
      for (const text of wrap(entry.text, entry.size, entry.bold)) {
        y += Math.ceil(entry.size * 1.35);
        lines.push({ text, y, size: entry.size, bold: entry.bold });
      }
    }
    return { lines, height: y + pad };
  };
  const titleSize = Math.max(20, Math.min(30, Math.round(width * 0.025)));
  const top = rows([
    { text: content.title, size: titleSize, bold: true },
    ...content.details.map((text) => ({ text, size: 18, bold: false })),
  ]);
  const bottom = rows(content.legend.map((text) => ({ text, size: 17, bold: false })));
  return {
    topHeight: top.height,
    bottomHeight: bottom.height,
    topLines: top.lines,
    bottomLines: bottom.lines,
  };
}

/**
 * Frame a rendered map with the classification banner above and below (security-controls CON-002:
 * the banner appears on every export).
 */
export async function frameWithBanner(
  map: Blob,
  marking: Marking,
  caveat: string | null,
  frame?: FrameLayout,
): Promise<Blob> {
  const image = await createImageBitmap(map);
  try {
    // A closed ImageBitmap reports zero size, so keep its size first.
    const { width, height } = image;
    const band = bandHeight(width);
    const top = frame?.topHeight ?? 0;
    const bottom = frame?.bottomHeight ?? 0;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height + top + bottom + 2 * band;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2D canvas");
    const colors = BANNER_COLORS[marking];
    const text = bannerText(marking, caveat);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, band + top);
    const drawLines = (lines: readonly FrameLine[], offset: number) => {
      context.fillStyle = "#1f2933";
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      for (const line of lines) {
        context.font = `${line.bold ? "bold " : ""}${String(line.size)}px "Segoe UI", system-ui, sans-serif`;
        context.fillText(line.text, Math.max(16, Math.round(width * 0.025)), offset + line.y);
      }
    };
    if (frame) {
      drawLines(frame.topLines, band);
      drawLines(frame.bottomLines, band + top + height);
    }
    for (const y of [0, band + top + height + bottom]) {
      context.fillStyle = colors.background;
      context.fillRect(0, y, canvas.width, band);
      context.fillStyle = colors.text;
      context.font = `bold ${String(Math.round(band * 0.6))}px "Segoe UI", system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(text, canvas.width / 2, y + band / 2, canvas.width - band);
    }
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("could not encode the PNG"));
      }, "image/png");
    });
  } finally {
    image.close();
  }
}
