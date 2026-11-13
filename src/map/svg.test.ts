import { describe, expect, it } from "vitest";
import { BANNER_COLORS, bandHeight, layoutFrame } from "./export";
import { mapStyle } from "./style";
import { escapeXml, type SvgEdge, type SvgNode, type SvgScene, svgDocument } from "./svg";

const node = (over: Partial<SvgNode> = {}): SvgNode => ({
  shape: "round-rectangle",
  x: 50,
  y: 40,
  width: 30,
  height: 30,
  fill: "#ffffff",
  fillOpacity: 1,
  stroke: "#5f6b7a",
  strokeWidth: 1.5,
  strokeOpacity: 1,
  strokeStyle: "solid",
  opacity: 1,
  label: {
    lines: ["Email"],
    x: 50,
    top: 60,
    size: 16,
    lineHeight: 19.2,
    bold: false,
    color: "#1f2933",
    opacity: 1,
    halo: 2,
  },
  ...over,
});

const edge = (over: Partial<SvgEdge> = {}): SvgEdge => ({
  start: { x: 0, y: 0 },
  controls: [],
  end: { x: 100, y: 0 },
  width: 2,
  color: "#9aa5b1",
  style: "solid",
  opacity: 1,
  arrowLength: 7,
  arrowHalfWidth: 3.5,
  ...over,
});

const scene = (over: Partial<SvgScene> = {}): SvgScene => ({
  view: { x: -10, y: -20, width: 400, height: 300 },
  pixelWidth: 800,
  pixelHeight: 600,
  containers: [],
  edges: [],
  nodes: [node()],
  ...over,
});

describe("escapeXml", () => {
  it("escapes markup and drops characters XML cannot hold", () => {
    expect(escapeXml(`A<script>&"'x\u0001\u000b`)).toBe("A&lt;script&gt;&amp;&quot;&apos;x");
    expect(escapeXml("tab\tand\nline")).toBe("tab\tand\nline");
  });
});

describe("svgDocument", () => {
  it("preserves a dark viewport and its label halo while retaining both classification bands", () => {
    const base = node();
    const dark = {
      ...scene(),
      background: "#102030",
      nodes: [
        {
          ...base,
          label: { ...(base.label as NonNullable<SvgNode["label"]>), color: "#d9e5ef", haloColor: "#102030" },
        },
      ],
    };
    const svg = svgDocument(dark, "SECRET", null);
    expect(svg).toContain('<rect x="-10" y="-20" width="400" height="300" fill="#102030"/>');
    expect(svg).toContain('fill="#d9e5ef"');
    expect(svg).toContain('stroke="#102030"');
    expect(svg.match(/>SECRET<\/text>/g)).toHaveLength(2);
  });
  it("places derived title and legend outside the map rectangle, with both marking bands intact", () => {
    const layout = layoutFrame(800, {
      title: "Map fixture — Compare: Future",
      details: ["Network: NIPR", "Committed document has unsaved changes"],
      legend: ["Depends on: consumer → provider", "Cross-network dependency, no CDS recorded"],
    });
    const svg = svgDocument(scene(), "SECRET", null, layout);
    expect(svg).toContain("Map fixture — Compare: Future");
    expect(svg).toContain("Depends on: consumer → provider");
    expect(svg).toContain(`y="${String(bandHeight(800) + layout.topHeight)}"`);
    expect(svg).toContain(`height="${String(600 + layout.topHeight + layout.bottomHeight + 2 * bandHeight(800))}"`);
    expect(svg).toContain("Committed document has unsaved changes");
  });

  it("frames the map with the banner above and below, at the PNG export's band height", () => {
    const svg = svgDocument(scene(), "SECRET", "REL TO USA");
    const band = bandHeight(800);
    expect(svg).toContain(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${String(600 + 2 * band)}"`);
    const bands = [...svg.matchAll(/<rect x="0" y="(\d+)" width="800" height="(\d+)" fill="([^"]+)"\/>/g)];
    const colored = bands.filter((m) => m[3] !== "#ffffff");
    expect(colored.map((m) => [Number(m[1]), Number(m[2]), m[3]])).toEqual([
      [0, band, BANNER_COLORS.SECRET.background],
      [band + 600, band, BANNER_COLORS.SECRET.background],
    ]);
    expect(svg.match(/>SECRET\/\/REL TO USA<\/text>/g)).toHaveLength(2);
    expect(svg).toContain('viewBox="-10 -20 400 300"');
  });

  it("escapes every name, so a dataset cannot inject markup", () => {
    const svg = svgDocument(
      scene({
        nodes: [
          node({
            label: { ...(node().label as NonNullable<SvgNode["label"]>), lines: ['<script>alert("x")</script>'] },
          }),
        ],
      }),
      "UNCLASSIFIED",
      "A&B <i>",
    );
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("<i>");
    expect(svg).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(svg).toContain("UNCLASSIFIED//A&amp;B &lt;i&gt;");
  });

  it("draws networks, then edges, then services and CDS, carrying dimming and dashes", () => {
    const svg = svgDocument(
      scene({
        containers: [node({ width: 200, height: 100, strokeStyle: "dashed", fillOpacity: 0.35, label: null })],
        edges: [edge({ style: "dotted", opacity: 0.25 })],
        nodes: [node({ shape: "diamond", opacity: 0.25 })],
      }),
      "CUI",
      null,
    );
    const container = svg.indexOf('<rect x="-50"');
    const line = svg.indexOf("<path");
    const diamond = svg.indexOf('<polygon points="50,25');
    expect(container).toBeGreaterThan(0);
    expect(line).toBeGreaterThan(container);
    expect(diamond).toBeGreaterThan(line);
    expect(svg).toContain('fill-opacity="0.35"');
    expect(svg).toContain('stroke-dasharray="4.5 2.25"');
    expect(svg).toContain('stroke-dasharray="2 3"');
    expect(svg.match(/<g opacity="0.25">/g)).toHaveLength(2);
  });

  it("ends a line at its arrow's base and points the arrow at the target", () => {
    const svg = svgDocument(scene({ edges: [edge()] }), "CUI", null);
    expect(svg).toContain('d="M0,0 L93,0"');
    expect(svg).toContain('points="100,0 93,3.5 93,-3.5"');
    const curved = svgDocument(
      scene({ edges: [edge({ controls: [{ x: 50, y: 50 }], end: { x: 100, y: 50 } })] }),
      "CUI",
      null,
    );
    expect(curved).toContain('d="M0,0 Q50,50 93,50"');
  });
});

describe("map style", () => {
  it("uses only node shapes and line styles the SVG export can draw", () => {
    for (const rule of mapStyle) {
      const style = (rule as unknown as { style: Record<string, unknown> }).style;
      if ("shape" in style) expect(["round-rectangle", "diamond"]).toContain(style["shape"]);
      for (const key of ["border-style", "line-style"]) {
        if (key in style) expect(["solid", "dashed", "dotted"]).toContain(style[key]);
      }
      for (const key of ["source-arrow-shape", "mid-target-arrow-shape"]) expect(style).not.toHaveProperty(key);
      if ("target-arrow-shape" in style) expect(style["target-arrow-shape"]).toBe("triangle");
    }
  });
});
