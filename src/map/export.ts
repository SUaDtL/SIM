import { bannerText, type Marking } from "../db/markings";
import { keyColor, keyDash, keyLabels, type MapKey } from "./key";

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
  readonly subject?: string;
  readonly keys?: readonly MapKey[];
  readonly details: readonly string[];
  readonly legend: readonly string[];
  /** Full marking/caveat, measured with the same font as the capture annotations. */
  readonly banner?: string;
}

export interface FrameLine {
  readonly text: string;
  readonly y: number;
  readonly size: number;
  readonly bold: boolean;
  readonly x?: number;
  readonly key?: MapKey;
}

export interface FrameLayout {
  /** Extra caption room when needed; the captured map retains its original rectangle. */
  readonly width?: number;
  /** Enlarged with annotations when preparing a capture for a 1280×720 presentation. */
  readonly bandHeight?: number;
  readonly bannerLines?: readonly FrameLine[];
  readonly topHeight: number;
  readonly bottomHeight: number;
  readonly topLines: readonly FrameLine[];
  readonly bottomLines: readonly FrameLine[];
}

/** Shared PNG/SVG frame geometry, with text wrapped within the captured viewport width. */
function frameAtWidth(
  width: number,
  content: FrameContent,
  measure: (text: string, size: number, bold: boolean) => number = (text, size) => text.length * size * 0.6,
  mapHeight?: number,
): FrameLayout {
  const pad = Math.max(16, Math.round(width * 0.025));
  const maxWidth = Math.max(1, width - 2 * pad);
  const wrap = (source: string, size: number, bold: boolean, limit = maxWidth): string[] => {
    const result: string[] = [];
    let line = "";
    for (const word of source.split(/\s+/)) {
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size, bold) <= limit) {
        line = candidate;
        continue;
      }
      if (line) result.push(line);
      line = "";
      for (const char of word) {
        if (line && measure(line + char, size, bold) > limit) {
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
  const atScale = (scale: number): FrameLayout => {
    const titleSize = Math.max(24, Math.min(30, Math.round(width * 0.025))) * scale;
    const top = rows([
      { text: content.title, size: titleSize, bold: true },
      ...(content.subject ? [{ text: content.subject, size: 24 * scale, bold: true }] : []),
      ...content.details.map((text) => ({ text, size: 18 * scale, bold: false })),
    ]);
    const keyLines: FrameLine[] = [];
    const keySize = 17 * scale;
    let x = pad;
    let y = pad + keySize;
    for (const key of content.keys ?? []) {
      const text = keyLabels[key];
      const chip = keySize * 2;
      const itemWidth = chip + measure(text, keySize, false);
      if (x > pad && x + itemWidth > width - pad) {
        x = pad;
        y += keySize * 1.65;
      }
      // Keep narrow-caption keys readable as a group by occupying their own wrapped row.
      if (itemWidth > maxWidth) {
        for (const [i, part] of wrap(text, keySize, false, Math.max(1, maxWidth - chip)).entries()) {
          keyLines.push({ text: part, size: keySize, bold: false, x: pad + chip, y, ...(i === 0 ? { key } : {}) });
          y += keySize * 1.4;
        }
        x = pad;
      } else {
        keyLines.push({ text, size: keySize, bold: false, x: x + chip, y, key });
        x += itemWidth + keySize * 1.25;
      }
    }
    const keyHeight = keyLines.length ? y + keySize * 0.45 : 0;
    const notes = rows(content.legend.map((text) => ({ text, size: keySize, bold: false })));
    const bottom = {
      lines: [...keyLines, ...notes.lines.map((line) => ({ ...line, y: line.y + keyHeight }))],
      height: Math.ceil(notes.height + keyHeight),
    };
    const minimumBand =
      mapHeight === undefined ? bandHeight(width) : Math.max(bandHeight(width), Math.ceil((17 * scale) / 0.6));
    const bannerSize = Math.round(minimumBand * 0.6);
    // A long marking/caveat can break at its delimiter before splitting a word.
    const separator = content.banner?.indexOf("//") ?? -1;
    const bannerRows = !content.banner
      ? []
      : separator >= 0 && measure(content.banner, bannerSize, true) > maxWidth
        ? [
            ...wrap(content.banner.slice(0, separator + 2), bannerSize, true),
            ...wrap(content.banner.slice(separator + 2), bannerSize, true),
          ]
        : wrap(content.banner, bannerSize, true);
    const bannerLineHeight = Math.ceil(bannerSize * 1.2);
    const actualBand = Math.max(minimumBand, bannerRows.length * bannerLineHeight + Math.ceil(bannerSize * 0.6));
    const bannerTop = (actualBand - bannerRows.length * bannerLineHeight) / 2;
    return {
      ...(mapHeight === undefined && !content.banner ? {} : { bandHeight: actualBand }),
      ...(content.banner
        ? {
            bannerLines: bannerRows.map((text, index) => ({
              text,
              y: bannerTop + index * bannerLineHeight + bannerSize,
              size: bannerSize,
              bold: true,
            })),
          }
        : {}),
      topHeight: top.height,
      bottomHeight: bottom.height,
      topLines: top.lines,
      bottomLines: bottom.lines,
    };
  };
  let scale = 1;
  let frame = atScale(scale);
  // Include the additional caption and band height in the fit calculation: width-only sizing
  // makes a tall map's legend tiny. Bounded iteration also handles line wrapping after growth.
  if (mapHeight !== undefined) {
    for (let pass = 0; pass < 16; pass++) {
      const fit = Math.min(
        1280 / width,
        720 / (mapHeight + frame.topHeight + frame.bottomHeight + 2 * (frame.bandHeight ?? 0)),
      );
      const displayed = 17 * scale * fit;
      // Raster bands and vector numeric attributes round independently.
      if (displayed >= 12.2) break;
      scale = Math.min(32, scale * (12.3 / displayed));
      frame = atScale(scale);
    }
  }
  return frame;
}

/** Keep complete annotations readable without squeezing or shrinking the captured map. */
export function layoutFrame(
  width: number,
  content: FrameContent,
  measure: (text: string, size: number, bold: boolean) => number = (text, size) => text.length * size * 0.6,
  mapHeight?: number,
): FrameLayout {
  const frame = frameAtWidth(width, content, measure, mapHeight);
  if (mapHeight === undefined) return frame;
  const fit = Math.min(
    1280 / width,
    720 / (mapHeight + frame.topHeight + frame.bottomHeight + 2 * (frame.bandHeight ?? 0)),
  );
  const smallest = Math.min(
    ...[...frame.topLines, ...frame.bottomLines, ...(frame.bannerLines ?? [])].map((line) => line.size),
  );
  if (smallest * fit >= 12) return frame;
  // Growing fonts alone on a narrow portrait can create ever more wrapped rows.
  // Letterbox that map inside a wider caption canvas instead; its scope and pixels stay intact.
  const captionWidth = Math.max(width * 2, Math.ceil((mapHeight * 1280) / 720));
  return { ...frameAtWidth(captionWidth, content, measure, mapHeight), width: captionWidth };
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
    const { width: mapWidth, height } = image;
    const width = frame?.width ?? mapWidth;
    const band = frame?.bandHeight ?? bandHeight(width);
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
    context.drawImage(image, (width - mapWidth) / 2, band + top);
    const drawLines = (lines: readonly FrameLine[], offset: number) => {
      context.fillStyle = "#1f2933";
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      for (const line of lines) {
        const x = line.x ?? Math.max(16, Math.round(width * 0.025));
        if (line.key) {
          context.save();
          context.translate(x - 2 * line.size, offset + line.y - 0.88 * line.size);
          context.scale(line.size / 16, line.size / 16);
          context.fillStyle = "#0d141c";
          context.fillRect(0, 0, 27, 16);
          context.strokeStyle = keyColor(line.key);
          context.fillStyle = keyColor(line.key);
          context.lineWidth = 2;
          context.beginPath();
          if (line.key === "service") context.roundRect(5, 4, 17, 8, 2);
          else if (line.key === "cds") {
            context.moveTo(13, 2);
            context.lineTo(20, 8);
            context.lineTo(13, 14);
            context.lineTo(6, 8);
            context.closePath();
            context.fill();
          } else {
            context.setLineDash(keyDash(line.key));
            context.moveTo(2, 8);
            context.lineTo(19, 8);
            context.stroke();
            context.setLineDash([]);
            context.beginPath();
            context.moveTo(18, 4);
            context.lineTo(24, 8);
            context.lineTo(18, 12);
            context.closePath();
            context.fill();
          }
          context.stroke();
          context.restore();
        }
        context.font = `${line.bold ? "bold " : ""}${String(line.size)}px "Segoe UI", system-ui, sans-serif`;
        context.fillText(line.text, x, offset + line.y);
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
      context.textAlign = "center";
      if (frame?.bannerLines) {
        context.textBaseline = "alphabetic";
        for (const line of frame.bannerLines) {
          context.font = `bold ${String(line.size)}px "Segoe UI", system-ui, sans-serif`;
          context.fillText(line.text, canvas.width / 2, y + line.y);
        }
      } else {
        context.font = `bold ${String(Math.round(band * 0.6))}px "Segoe UI", system-ui, sans-serif`;
        context.textBaseline = "middle";
        context.fillText(text, canvas.width / 2, y + band / 2, canvas.width - band);
      }
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
