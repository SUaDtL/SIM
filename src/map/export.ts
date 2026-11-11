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

/**
 * Frame a rendered map with the classification banner above and below (security-controls CON-002:
 * the banner appears on every export).
 */
export async function frameWithBanner(map: Blob, marking: Marking, caveat: string | null): Promise<Blob> {
  const image = await createImageBitmap(map);
  // A closed ImageBitmap reports zero size, so keep its size first.
  const { width, height } = image;
  const band = bandHeight(width);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height + 2 * band;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  const colors = BANNER_COLORS[marking];
  const text = bannerText(marking, caveat);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, band);
  image.close();
  for (const y of [0, band + height]) {
    context.fillStyle = colors.background;
    context.fillRect(0, y, canvas.width, band);
    context.fillStyle = colors.text;
    context.font = `bold ${String(Math.round(band * 0.6))}px "Segoe UI", system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, y + band / 2, canvas.width - band);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("could not encode the PNG"));
    }, "image/png");
  });
}
