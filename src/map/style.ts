import type { StylesheetJson } from "cytoscape";

// Edge colors follow the layout spike: grey stays local, orange passes a CDS, red crosses a boundary
// with no CDS (the risk to notice), tan reaches an external network.
const ink = "#1f2933";
const muted = "#5f6b7a";

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
    },
  },
  {
    selector: "node.network",
    style: {
      shape: "round-rectangle",
      "background-color": "#eef1f5",
      "border-color": "#9aa5b1",
      "border-width": 1.5,
      padding: "20px",
      "text-valign": "top",
      "text-halign": "center",
      "text-margin-y": -4,
      "font-size": 20,
      "font-weight": "bold",
    },
  },
  {
    selector: "node.network.external",
    style: { "background-color": "#fbf6ee", "border-color": "#b08850", "border-style": "dashed" },
  },
  {
    selector: "node.service",
    style: {
      shape: "round-rectangle",
      width: 30,
      height: 30,
      "background-color": "#ffffff",
      "border-color": muted,
      "border-width": 1.5,
      "text-valign": "bottom",
      "text-margin-y": 4,
    },
  },
  { selector: "node.service.foundational", style: { "background-color": "#dfe5ec", "border-style": "dotted" } },
  {
    selector: "node.cds",
    style: {
      shape: "diamond",
      width: 44,
      height: 44,
      "background-color": "#e8892b",
      "border-color": "#a85a12",
      "border-width": 1.5,
      "text-valign": "bottom",
      "text-margin-y": 4,
      "font-weight": "bold",
    },
  },
  { selector: "node:selected", style: { "border-color": "#2457a6", "border-width": 3 } },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      width: 2,
      "line-color": "#9aa5b1",
      "target-arrow-color": "#9aa5b1",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
    },
  },
  { selector: "edge.via-cds", style: { width: 3.5, "line-color": "#e8892b", "target-arrow-color": "#e8892b" } },
  {
    selector: "edge.cross-domain",
    style: { width: 3.5, "line-color": "#c62828", "target-arrow-color": "#c62828", "line-style": "dashed" },
  },
  {
    selector: "edge.external",
    style: { width: 3, "line-color": "#b08850", "target-arrow-color": "#b08850", "line-style": "dotted" },
  },
  { selector: ".hidden", style: { display: "none" } },
];
