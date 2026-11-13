import type { StylesheetJson } from "cytoscape";

// Edge colors follow the layout spike: grey stays local, orange passes a CDS, red crosses a boundary
// with no CDS (the risk to notice), tan reaches an external network.
export const MAP_BACKGROUND = "#0d141c";
const ink = "#d9e5ef";
const muted = "#88a5bc";

export const mapStyle: StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "font-family": "Segoe UI, system-ui, sans-serif",
      "font-size": 16,
      color: ink,
      "text-wrap": "wrap",
      "text-max-width": "140px",
      // The canvas-colored halo keeps labels legible across edges and network borders.
      "text-outline-color": "#0d141c",
      "text-outline-width": 2,
      "text-outline-opacity": 0.85,
    },
  },
  {
    selector: "node.network",
    style: {
      shape: "round-rectangle",
      "background-color": "#172431",
      "border-color": "#6c8296",
      "border-width": 1.5,
      padding: "20px",
      "text-valign": "top",
      "text-halign": "center",
      "text-margin-y": -4,
      "font-size": 20,
      "font-weight": "bold",
      // Labels grow when zoomed out (up to twice the size); keep names on one line.
      "text-max-width": "400px",
    },
  },
  {
    selector: "node.network.external",
    style: { "background-color": "#2c2921", "border-color": "#c7ad80", "border-style": "dashed" },
  },
  {
    selector: "node.service",
    style: {
      shape: "round-rectangle",
      width: 30,
      height: 30,
      "background-color": "#2b4356",
      "border-color": muted,
      "border-width": 1.5,
      "text-valign": "bottom",
      "text-margin-y": 4,
    },
  },
  { selector: "node.service.foundational", style: { "background-color": "#21323f", "border-style": "dotted" } },
  {
    selector: "node.cds",
    style: {
      shape: "diamond",
      width: 44,
      height: 44,
      "background-color": "#f3ac58",
      "border-color": "#ce8436",
      "border-width": 1.5,
      "text-valign": "bottom",
      "text-margin-y": 4,
      "font-weight": "bold",
      "text-max-width": "280px",
    },
  },
  { selector: "node:selected", style: { "border-color": "#65c7dc", "border-width": 3 } },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      width: 2,
      "line-color": "#6c8296",
      "target-arrow-color": "#6c8296",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
    },
  },
  { selector: "edge.via-cds", style: { width: 3.5, "line-color": "#f3ac58", "target-arrow-color": "#f3ac58" } },
  {
    selector: "edge.cross-domain",
    style: { width: 3.5, "line-color": "#f27575", "target-arrow-color": "#f27575", "line-style": "dashed" },
  },
  {
    selector: "edge.unresolved",
    style: { width: 4, "line-color": "#ba9df5", "target-arrow-color": "#ba9df5", "line-style": "dashed" },
  },
  {
    selector: "edge.external",
    style: { width: 3, "line-color": "#c7ad80", "target-arrow-color": "#c7ad80", "line-style": "dotted" },
  },
  // Compare view (WORK-013): what a scenario adds or keeps is green, what it moves is purple and
  // dashed, and what it removes stays as a faded ghost (red border when retired).
  {
    selector: "node.service.added",
    style: { "background-color": "#193c2e", "border-color": "#73c59c", "border-width": 3 },
  },
  { selector: "node.service.merge-target", style: { "border-color": "#73c59c", "border-width": 4 } },
  {
    selector: "node.service.remote-endpoint",
    style: { "border-style": "dashed", "border-width": 3, "border-color": "#9baecb" },
  },
  {
    selector: "node.service.rehomed",
    style: { "border-color": "#ba9df5", "border-width": 3, "border-style": "dashed" },
  },
  {
    selector: "node.service.retired, node.service.merged",
    style: { opacity: 0.45, "border-style": "dashed", "background-color": "#25303b" },
  },
  { selector: "node.service.retired", style: { "border-color": "#f27575" } },
  { selector: "edge.removed", style: { opacity: 0.3, "line-style": "dashed", width: 1.5 } },
  // A highlighted chain stands out and the rest fades. A network is faded through its own fill,
  // border and label: "opacity" on a container would also fade the services inside it.
  { selector: "node.chain-root", style: { "border-color": "#65c7dc", "border-width": 4 } },
  { selector: "edge.chain", style: { width: 4.5 } },
  { selector: "node.service.dimmed, node.cds.dimmed, edge.dimmed", style: { opacity: 0.25 } },
  {
    selector: "node.network.dimmed",
    style: { "background-opacity": 0.35, "border-opacity": 0.35, "text-opacity": 0.35 },
  },
  // Zoomed out, service labels are hidden ("quiet") unless hovered or part of a highlighted chain.
  { selector: "node.service.quiet", style: { label: "" } },
  { selector: "node.service.quiet.hover, node.service.quiet.chain", style: { label: "data(label)" } },
  {
    selector: "node.hover",
    style: { "z-index": 20, "text-background-color": "#0d141c", "text-background-opacity": 0.9 },
  },
  // Later rules win: a chain shows its foundational links (Q-021), and a filter hides even those.
  { selector: ".hidden", style: { display: "none" } },
  { selector: "edge.chain", style: { display: "element" } },
  { selector: ".filtered", style: { display: "none" } },
];
