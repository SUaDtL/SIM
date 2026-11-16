import type { Core, EdgeSingular, NodeSingular, SingularElementArgument } from "cytoscape";
import type { LineStyle, Point, SvgEdge, SvgLabel, SvgNode, SvgScene } from "./svg";
import { MAP_BACKGROUND } from "./style";

/**
 * Read the drawn map into an SVG scene (WORK-012): what is visible in the current view, with each
 * element's computed style, so highlight, dimming and filters carry into the export as on screen.
 */

/** Wrap text to a width the way the map does: at spaces, breaking only words wider than the line. */
export type Measure = (text: string, font: string) => number;

/** A computed style value as text (Cytoscape types style values loosely). */
const text = (ele: SingularElementArgument, name: string): string => String(ele.style(name) as unknown);

const number = (ele: SingularElementArgument, name: string): number => Number(ele.numericStyle(name) as unknown);

function lineStyle(value: string): LineStyle {
  if (value === "solid" || value === "dashed" || value === "dotted") return value;
  throw new Error(`SVG export does not draw the ${value} line style`);
}

function wrap(text: string, max: number, font: string, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line === "" ? word : `${line} ${word}`;
      if (line !== "" && measure(next, font) > max) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function nodeLabel(n: NodeSingular, measure: Measure): SvgLabel | null {
  const value = text(n, "label");
  if (value === "" || number(n, "text-opacity") === 0) return null;
  const size = number(n, "font-size");
  const bold = text(n, "font-weight") === "bold" || number(n, "font-weight") >= 600;
  const halo = number(n, "text-outline-width");
  const font = `${bold ? "bold " : ""}${String(size)}px "Segoe UI", system-ui, sans-serif`;
  const lines = wrap(value, number(n, "text-max-width"), font, measure);
  // The map's own label box places the text, so the export puts it where the screen does.
  const box = n.boundingBox({ includeNodes: false, includeEdges: false, includeLabels: true });
  // Match the renderer's line spacing. An independently enlarged SVG block can
  // collide with the adjacent heading even when the live label boxes are clear.
  const lineHeight = size * number(n, "line-height");
  const blockHeight = lines.length * lineHeight;
  return {
    lines,
    x: (box.x1 + box.x2) / 2,
    top: (box.y1 + box.y2) / 2 - blockHeight / 2,
    size,
    lineHeight,
    bold,
    color: text(n, "color"),
    opacity: number(n, "text-opacity"),
    halo: number(n, "text-outline-opacity") > 0 ? halo : 0,
    haloColor: text(n, "text-outline-color"),
  };
}

function svgNode(n: NodeSingular, measure: Measure): SvgNode {
  const shape = text(n, "shape");
  if (shape !== "round-rectangle" && shape !== "diamond") {
    throw new Error(`SVG export does not draw the ${shape} node shape`);
  }
  // A compound network's box comes from its services; a leaf's from its own size.
  const box = n.isParent() ? n.boundingBox({ includeLabels: false, includeOverlays: false }) : null;
  const border = number(n, "border-width");
  return {
    shape,
    x: box ? (box.x1 + box.x2) / 2 : n.position().x,
    y: box ? (box.y1 + box.y2) / 2 : n.position().y,
    width: box ? box.x2 - box.x1 - border : n.width(),
    height: box ? box.y2 - box.y1 - border : n.height(),
    fill: text(n, "background-color"),
    fillOpacity: number(n, "background-opacity"),
    stroke: text(n, "border-color"),
    strokeWidth: border,
    strokeOpacity: number(n, "border-opacity"),
    strokeStyle: lineStyle(text(n, "border-style")),
    opacity: number(n, "opacity"),
    label: nodeLabel(n, measure),
  };
}

/** A position from Cytoscape (typed loosely) as a plain point. */
const point = (p: unknown): Point => {
  const { x, y } = p as Point;
  return { x, y };
};

function svgEdge(e: EdgeSingular): SvgEdge {
  const width = number(e, "width");
  const scale = number(e, "arrow-scale");
  // Cytoscape's arrow size for a line of this width.
  const size = Math.max(Math.pow(width * 13.37, 0.9), 29) * scale;
  return {
    start: point(e.sourceEndpoint()),
    controls: ((e.controlPoints() as unknown as Point[] | undefined) ?? []).map(point),
    end: point(e.targetEndpoint()),
    width,
    color: text(e, "line-color"),
    style: lineStyle(text(e, "line-style")),
    opacity: number(e, "opacity"),
    arrowLength: size * 0.3,
    arrowHalfWidth: size * 0.15,
  };
}

/** The current view of the map at `scale` pixels per screen pixel. */
export function sceneFromMap(cy: Core, scale: number, measure: Measure): SvgScene {
  const extent = cy.extent();
  const overlaps = (b: { x1: number; y1: number; x2: number; y2: number }) =>
    b.x1 < extent.x2 && b.x2 > extent.x1 && b.y1 < extent.y2 && b.y2 > extent.y1;
  const inView = (ele: SingularElementArgument) => ele.visible() && overlaps(ele.boundingBox({}));
  const nodes = cy
    .nodes()
    .map((n) => n)
    .filter((n) => inView(n));
  return {
    view: { x: extent.x1, y: extent.y1, width: extent.w, height: extent.h },
    background: MAP_BACKGROUND,
    pixelWidth: Math.round(cy.width() * scale),
    pixelHeight: Math.round(cy.height() * scale),
    containers: nodes.filter((n) => n.isParent()).map((n) => svgNode(n, measure)),
    edges: cy
      .edges()
      .filter((e) => inView(e))
      .edges()
      .map((e) => svgEdge(e)),
    nodes: nodes.filter((n) => !n.isParent()).map((n) => svgNode(n, measure)),
  };
}
