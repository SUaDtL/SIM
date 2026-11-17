import { UUID_V4, type ExchangeTable } from "../domain/assessment-context";
import type { MapViewState } from "./map-view";
import type { Graph, GraphOrigin, MapEntity } from "./graph";

type IdentityLookup = (table: ExchangeTable) => ReadonlyMap<string, string>;

export interface Viewpoint {
  readonly version: 1;
  readonly projection: "as-is" | "to-be" | "compare";
  readonly scenario: string | null;
  readonly filters: {
    readonly network: string | null;
    readonly category: string | null;
    readonly organization: string | null;
  };
  readonly focus: {
    readonly kind: "depends-on" | "used-by" | "network-connections";
    readonly subject: ViewSubject;
    readonly depth: number;
  } | null;
  readonly chain: ViewSubject | null;
  readonly selection: ViewSubject | null;
  readonly foundational: boolean;
  readonly framing: {
    readonly zoom: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

type ViewSubject = { readonly kind: MapEntity | "planned"; readonly identity: string };

const subjectKinds = new Set(["network", "service", "cds", "planned"]);
const focusKinds = new Set(["depends-on", "used-by", "network-connections"]);
const projections = new Set(["as-is", "to-be", "compare"]);
type RecordValue = Record<string, unknown>;

function object(value: unknown, keys: readonly string[]): value is RecordValue {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
const uuid = (value: unknown): value is string => typeof value === "string" && UUID_V4.test(value);
const optionalUuid = (value: unknown): boolean => value === null || uuid(value);
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const subject = (value: unknown): boolean =>
  object(value, ["kind", "identity"]) &&
  typeof value["kind"] === "string" &&
  subjectKinds.has(value["kind"]) &&
  uuid(value["identity"]);

export function parseViewpoint(text: string): Viewpoint {
  if (text.length > 4096) throw new Error("Saved view is too large.");
  const row: unknown = JSON.parse(text);
  if (
    !object(row, [
      "version",
      "projection",
      "scenario",
      "filters",
      "focus",
      "chain",
      "selection",
      "foundational",
      "framing",
    ]) ||
    row["version"] !== 1 ||
    typeof row["projection"] !== "string" ||
    !projections.has(row["projection"]) ||
    (row["projection"] === "as-is" ? row["scenario"] !== null : !uuid(row["scenario"])) ||
    typeof row["foundational"] !== "boolean" ||
    (row["chain"] !== null && !subject(row["chain"])) ||
    (row["selection"] !== null && !subject(row["selection"]))
  )
    throw new Error("Invalid saved view definition.");
  const filters = row["filters"];
  const focus = row["focus"];
  const framing = row["framing"];
  if (
    !object(filters, ["network", "category", "organization"]) ||
    !Object.values(filters).every(optionalUuid) ||
    (focus !== null &&
      (!object(focus, ["kind", "subject", "depth"]) ||
        typeof focus["kind"] !== "string" ||
        !focusKinds.has(focus["kind"]) ||
        !subject(focus["subject"]) ||
        !finite(focus["depth"], 1, 100) ||
        !Number.isInteger(focus["depth"]))) ||
    !object(framing, ["zoom", "x", "y", "width", "height"]) ||
    !finite(framing["zoom"], 0.00001, 100) ||
    !finite(framing["x"], -1e9, 1e9) ||
    !finite(framing["y"], -1e9, 1e9) ||
    !finite(framing["width"], 1, 1e5) ||
    !finite(framing["height"], 1, 1e5)
  ) {
    throw new Error("Invalid saved view scope or framing.");
  }
  return row as unknown as Viewpoint;
}

function recordedId(lookup: IdentityLookup, table: ExchangeTable, id: number): string {
  const value = lookup(table).get(String(id));
  if (!value) throw new Error("A selected map record no longer exists.");
  return value;
}

function identify(origin: GraphOrigin, lookup: IdentityLookup): ViewSubject {
  return origin.kind === "planned"
    ? { kind: "planned", identity: recordedId(lookup, "scenario_change", origin.changeId) }
    : { kind: origin.entity, identity: recordedId(lookup, origin.entity, origin.entityId) };
}

export function createViewpoint(
  state: MapViewState,
  graph: Graph,
  dimensions: { width: number; height: number },
  lookup: IdentityLookup,
): Viewpoint {
  function find(id: string | null): ViewSubject | null {
    if (id === null) return null;
    const origin = graph.nodes.find((node) => node.data.id === id)?.data.origin;
    if (!origin) throw new Error("A selected map record no longer exists.");
    return identify(origin, lookup);
  }
  const { zoom, pan, view, filter } = state;
  const { width, height } = dimensions;
  const focus = state.focus && find(state.focus.subject);
  return {
    version: 1,
    projection: view.kind,
    scenario: view.kind === "as-is" ? null : recordedId(lookup, "scenario", view.scenarioId),
    filters: {
      network: filter.networkId === undefined ? null : recordedId(lookup, "network", filter.networkId),
      category: filter.categoryId === undefined ? null : recordedId(lookup, "category", filter.categoryId),
      organization: filter.orgId === undefined ? null : recordedId(lookup, "organization", filter.orgId),
    },
    focus: state.focus && focus ? { kind: state.focus.kind, depth: state.focus.depth, subject: focus } : null,
    chain: find(state.chainRoot),
    selection: find(state.selectedNode ?? null),
    foundational: state.foundational,
    framing: { zoom, x: (width / 2 - pan.x) / zoom, y: (height / 2 - pan.y) / zoom, width, height },
  };
}

export function resolveViewpoint(
  view: Viewpoint,
  lookup: IdentityLookup,
  graphFor: (view: MapViewState["view"]) => Graph,
  dimensions: { width: number; height: number },
): { state: MapViewState; resized: boolean } {
  function resolveId(table: ExchangeTable, identity: string | null): number | undefined {
    if (identity === null) return undefined;
    for (const [key, value] of lookup(table)) if (value === identity) return Number(key);
    throw new Error("A saved scenario or filter is unavailable. Edit the saved view to replace its scope.");
  }
  const scenarioId = resolveId("scenario", view.scenario);
  const wanted: MapViewState["view"] =
    view.projection === "as-is" || scenarioId === undefined ? { kind: "as-is" } : { kind: view.projection, scenarioId };
  const graph = graphFor(wanted);
  function resolveSubject(saved: ViewSubject | null): string | null {
    if (!saved) return null;
    const node = graph.nodes.find(({ data: { origin } }) => {
      if (saved.kind === "planned") {
        return origin.kind === "planned" && lookup("scenario_change").get(String(origin.changeId)) === saved.identity;
      }
      return (
        origin.kind === "baseline" &&
        origin.entity === saved.kind &&
        lookup(origin.entity).get(String(origin.entityId)) === saved.identity
      );
    });
    if (!node)
      throw new Error(
        "A saved map subject is unavailable in this projection. Edit the saved view to replace its scope.",
      );
    return node.data.id;
  }
  const focus = view.focus && resolveSubject(view.focus.subject);
  const networkId = resolveId("network", view.filters.network);
  const categoryId = resolveId("category", view.filters.category);
  const orgId = resolveId("organization", view.filters.organization);
  const { width, height } = dimensions;
  const { framing } = view;
  const scale = Math.min(1, width / framing.width, height / framing.height);
  const zoom = Math.max(0.01, framing.zoom * scale);
  return {
    resized: scale < 0.9,
    state: {
      view: wanted,
      filter: {
        ...(networkId === undefined ? {} : { networkId }),
        ...(categoryId === undefined ? {} : { categoryId }),
        ...(orgId === undefined ? {} : { orgId }),
      },
      chainRoot: resolveSubject(view.chain),
      selectedNode: resolveSubject(view.selection),
      foundational: view.foundational,
      focus: view.focus && focus ? { kind: view.focus.kind, depth: view.focus.depth, subject: focus } : null,
      zoom,
      pan: { x: width / 2 - framing.x * zoom, y: height / 2 - framing.y * zoom },
    },
  };
}
