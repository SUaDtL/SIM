import { bannerText, type Marking } from "../db/markings";
import { BANNER_COLORS, bandHeight, type FrameLayout } from "./export";

/**
 * SVG export (WORK-012): a drawn map as plain SVG shapes and text, framed by the classification
 * banner (security-controls CON-002). The scene is read from the map in the view; this module only
 * writes it out, so it is pure and every piece of text passes through one escape.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type LineStyle = "solid" | "dashed" | "dotted";

export interface SvgLabel {
  readonly lines: readonly string[];
  /** Center of the text block horizontally, top of the first line. */
  readonly x: number;
  readonly top: number;
  readonly size: number;
  readonly lineHeight: number;
  readonly bold: boolean;
  readonly color: string;
  readonly opacity: number;
  /** Halo width around the letters, with the drawn map's outline color. */
  readonly halo: number;
  readonly haloColor?: string;
}

export interface SvgNode {
  readonly shape: "round-rectangle" | "diamond";
  /** Center and size. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly fillOpacity: number;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeOpacity: number;
  readonly strokeStyle: LineStyle;
  readonly opacity: number;
  readonly label: SvgLabel | null;
}

export interface SvgEdge {
  readonly start: Point;
  readonly controls: readonly Point[];
  /** Where the arrow's tip touches the target. */
  readonly end: Point;
  readonly width: number;
  readonly color: string;
  readonly style: LineStyle;
  readonly opacity: number;
  /** Arrow length along the edge and half its width. */
  readonly arrowLength: number;
  readonly arrowHalfWidth: number;
}

export interface SvgScene {
  readonly background?: string;
  /** The part of the map shown, in map coordinates. */
  readonly view: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Size of the drawn map in pixels (without the banner). */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Drawn in order: networks, then edges, then services and CDS. */
  readonly containers: readonly SvgNode[];
  readonly edges: readonly SvgEdge[];
  readonly nodes: readonly SvgNode[];
}

const FONT = '"Segoe UI", system-ui, sans-serif';

/** Characters XML 1.0 cannot hold at all, even escaped. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

/** Escape text for an XML attribute or text node. Dataset names are untrusted. */
export function escapeXml(text: string): string {
  return text
    .replace(NOT_XML, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const num = (n: number) => String(Math.round(n * 100) / 100);

function tag(name: string, attrs: Record<string, string | number | null>, body?: string): string {
  const list = Object.entries(attrs)
    .filter((entry): entry is [string, string | number] => entry[1] !== null)
    .map(([k, v]) => ` ${k}="${typeof v === "number" ? num(v) : escapeXml(v)}"`)
    .join("");
  return body === undefined ? `<${name}${list}/>` : `<${name}${list}>${body}</${name}>`;
}

function dash(style: LineStyle, width: number): string | null {
  if (style === "dashed") return `${num(width * 3)} ${num(width * 1.5)}`;
  if (style === "dotted") return `${num(width)} ${num(width * 1.5)}`;
  return null;
}

const opacity = (value: number) => (value < 1 ? value : null);

function label(l: SvgLabel): string {
  const lines = l.lines.map((line, i) =>
    tag("tspan", { x: l.x, y: l.top + i * l.lineHeight + l.size * 0.92 }, escapeXml(line)),
  );
  return tag(
    "text",
    {
      "text-anchor": "middle",
      "font-family": FONT,
      "font-size": l.size,
      "font-weight": l.bold ? "bold" : null,
      fill: l.color,
      opacity: opacity(l.opacity),
      stroke: l.halo > 0 ? (l.haloColor ?? "#ffffff") : null,
      "stroke-width": l.halo > 0 ? l.halo * 2 : null,
      "stroke-opacity": l.halo > 0 ? 0.85 : null,
      "stroke-linejoin": l.halo > 0 ? "round" : null,
      "paint-order": l.halo > 0 ? "stroke" : null,
    },
    lines.join(""),
  );
}

function node(n: SvgNode): string {
  const paint = {
    fill: n.fill,
    "fill-opacity": opacity(n.fillOpacity),
    stroke: n.strokeWidth > 0 ? n.stroke : null,
    "stroke-width": n.strokeWidth > 0 ? n.strokeWidth : null,
    "stroke-opacity": opacity(n.strokeOpacity),
    "stroke-dasharray": dash(n.strokeStyle, n.strokeWidth),
  };
  const x = n.x - n.width / 2;
  const y = n.y - n.height / 2;
  const body =
    n.shape === "diamond"
      ? tag("polygon", {
          points: [
            [n.x, y],
            [x + n.width, n.y],
            [n.x, y + n.height],
            [x, n.y],
          ]
            .map(([px, py]) => `${num(px ?? 0)},${num(py ?? 0)}`)
            .join(" "),
          ...paint,
        })
      : tag("rect", {
          x,
          y,
          width: n.width,
          height: n.height,
          // Cytoscape's round-rectangle corner radius.
          rx: Math.min(n.width / 4, n.height / 4, 8),
          ...paint,
        });
  return tag("g", { opacity: opacity(n.opacity) }, body + (n.label ? label(n.label) : ""));
}

function edge(e: SvgEdge): string {
  const last = e.controls.at(-1) ?? e.start;
  const dx = e.end.x - last.x;
  const dy = e.end.y - last.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  // The line stops at the arrow's base so its end does not poke through the tip.
  const base = { x: e.end.x - ux * e.arrowLength, y: e.end.y - uy * e.arrowLength };
  let d = `M${num(e.start.x)},${num(e.start.y)}`;
  if (e.controls.length === 0) d += ` L${num(base.x)},${num(base.y)}`;
  else {
    // Several control points make a chain of quadratic curves through their midpoints.
    e.controls.forEach((c, i) => {
      const next = e.controls[i + 1];
      const to = next ? { x: (c.x + next.x) / 2, y: (c.y + next.y) / 2 } : base;
      d += ` Q${num(c.x)},${num(c.y)} ${num(to.x)},${num(to.y)}`;
    });
  }
  const arrow = [
    e.end,
    { x: base.x - uy * e.arrowHalfWidth, y: base.y + ux * e.arrowHalfWidth },
    { x: base.x + uy * e.arrowHalfWidth, y: base.y - ux * e.arrowHalfWidth },
  ]
    .map((p) => `${num(p.x)},${num(p.y)}`)
    .join(" ");
  return tag(
    "g",
    { opacity: opacity(e.opacity) },
    tag("path", {
      d,
      fill: "none",
      stroke: e.color,
      "stroke-width": e.width,
      "stroke-dasharray": dash(e.style, e.width),
    }) + tag("polygon", { points: arrow, fill: e.color }),
  );
}

/** The scene as a standalone SVG document, with the banner above and below the map. */
export function svgDocument(scene: SvgScene, marking: Marking, caveat: string | null, frame?: FrameLayout): string {
  const mapWidth = scene.pixelWidth;
  const width = frame?.width ?? mapWidth;
  const band = frame?.bandHeight ?? bandHeight(width);
  const top = frame?.topHeight ?? 0;
  const bottom = frame?.bottomHeight ?? 0;
  const height = scene.pixelHeight + top + bottom + 2 * band;
  const colors = BANNER_COLORS[marking];
  const text = bannerText(marking, caveat);
  const banner = (y: number) =>
    tag("rect", { x: 0, y, width, height: band, fill: colors.background }) +
    (frame?.bannerLines
      ? frame.bannerLines
          .map((line) =>
            tag(
              "text",
              {
                x: width / 2,
                y: y + line.y,
                "text-anchor": "middle",
                "font-family": FONT,
                "font-size": line.size,
                "font-weight": "bold",
                fill: colors.text,
              },
              escapeXml(line.text),
            ),
          )
          .join("")
      : tag(
          "text",
          {
            x: width / 2,
            y: y + band / 2 + band * 0.21,
            "text-anchor": "middle",
            "font-family": FONT,
            "font-size": Math.round(band * 0.6),
            "font-weight": "bold",
            fill: colors.text,
          },
          escapeXml(text),
        ));
  const v = scene.view;
  const map = tag(
    "svg",
    {
      x: (width - mapWidth) / 2,
      y: band + top,
      width: mapWidth,
      height: scene.pixelHeight,
      viewBox: `${num(v.x)} ${num(v.y)} ${num(v.width)} ${num(v.height)}`,
    },
    (scene.background
      ? tag("rect", { x: v.x, y: v.y, width: v.width, height: v.height, fill: scene.background })
      : "") + [...scene.containers.map(node), ...scene.edges.map(edge), ...scene.nodes.map(node)].join(""),
  );
  const frameLines = (lines: FrameLayout["topLines"], offset: number) =>
    lines
      .map((line) =>
        tag(
          "text",
          {
            x: Math.max(16, Math.round(width * 0.025)),
            y: offset + line.y,
            "font-family": FONT,
            "font-size": line.size,
            "font-weight": line.bold ? "bold" : null,
            fill: "#1f2933",
          },
          escapeXml(line.text),
        ),
      )
      .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    tag(
      "svg",
      { xmlns: "http://www.w3.org/2000/svg", width, height, viewBox: `0 0 ${num(width)} ${num(height)}` },
      tag("title", {}, escapeXml(`SIM map - ${text}`)) +
        tag("rect", { x: 0, y: 0, width, height, fill: "#ffffff" }) +
        map +
        (frame
          ? frameLines(frame.topLines, band) + frameLines(frame.bottomLines, band + top + scene.pixelHeight)
          : "") +
        banner(0) +
        banner(band + top + scene.pixelHeight + bottom),
    ) +
    "\n"
  );
}
