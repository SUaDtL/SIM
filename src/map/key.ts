import type { EdgeKind } from "./graph";

/** These map colors also supply the screen and detached capture keys. */
export const routeColors: Record<EdgeKind, string> = {
  local: "#91a8af",
  "via-cds": "#f3ac58",
  "cross-domain": "#f27575",
  external: "#c7ad80",
  unresolved: "#ba9df5",
};

export type MapKey = EdgeKind | "service" | "cds";

export const keyLabels: Record<MapKey, string> = {
  service: "Service",
  cds: "CDS gateway",
  local: "Depends on: consumer → provider",
  "via-cds": "Dependency routed via CDS",
  "cross-domain": "Cross-network dependency, no CDS recorded",
  external: "Dependency on external network",
  unresolved: "Unresolved former-CDS route; review scenario change",
};

export function keyColor(key: MapKey): string {
  return key === "service" ? "#9abfb8" : key === "cds" ? routeColors["via-cds"] : routeColors[key];
}

export function keyDash(key: MapKey): number[] {
  if (key === "external") return [1, 2];
  if (key === "cross-domain" || key === "unresolved") return [3, 2];
  return [];
}
