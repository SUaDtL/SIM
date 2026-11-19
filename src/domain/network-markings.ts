import type { SqlValue } from "sql.js";
import { isMarking } from "../db/markings";
import { UUID_V4 } from "./assessment-context";
import { ValidationError } from "./errors";
import {
  MARKING_PRESETS,
  type MarkingFields,
  type MarkingSelection,
  type NetworkMarking,
} from "./network-marking-catalog";
import type { Network } from "./types";

export const NETWORK_LABEL_NOTE =
  "Network markings describe networks on the diagram. The source dataset marking is shown separately.";

const presetByKey = new Map(MARKING_PRESETS.map((preset) => [preset.key, preset]));
export const findMarkingPreset = (key: string) => presetByKey.get(key);

export function normalizeMarkingLabel(label: string): string {
  return label.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function markingSelectionValue(marking: MarkingSelection): string {
  return marking.source + ":" + marking.key;
}

export function readMarkingSelection(value: string): MarkingSelection | undefined {
  if (value.startsWith("builtin:")) return { source: "builtin", key: value.slice(8) };
  if (value.startsWith("custom:")) return { source: "custom", key: value.slice(7) };
  return undefined;
}

export function networkMarkingLabel(network: Network): string {
  return network.diagramMarking?.fullLabel ?? network.marking;
}

export function networkMarkingFilterKey(network: Network): string {
  const marking = network.diagramMarking ?? MARKING_PRESETS.find((entry) => entry.fullLabel === network.marking);
  return marking ? markingSelectionValue(marking) : "";
}

export function validMarkingFilterKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const selection = readMarkingSelection(value);
  return selection?.source === "builtin"
    ? findMarkingPreset(selection.key) !== undefined
    : selection?.source === "custom" && UUID_V4.test(selection.key);
}

export function markingTextMatches(marking: NetworkMarking, query: string): boolean {
  const terms = normalizeMarkingLabel(query).split(" ");
  const text = normalizeMarkingLabel(
    [
      marking.fullLabel,
      marking.shortLabel,
      marking.description,
      ...(marking.source === "builtin" ? marking.keywords : []),
    ].join(" "),
  );
  return terms.every((term) => text.includes(term));
}

function labelText(value: string, limit: number, field: string): string {
  // Preserve punctuation and spacing across text and SVG. Reject controls, bidi overrides, and invalid Unicode.
  if (/[\p{Cc}\p{Cs}\u2028-\u202e\u2066-\u2069\ufffe\uffff]/u.test(value))
    throw new ValidationError("INVALID_VALUE", field, "Use visible text without control characters.");
  const trimmed = value.trim();
  if (Array.from(trimmed).length > limit)
    throw new ValidationError("TOO_LONG", field, "Use at most " + String(limit) + " characters.");
  return trimmed;
}

export function validateMarkingFields(input: MarkingFields): MarkingFields {
  const fullLabel = labelText(input.fullLabel, 120, "Displayed marking");
  const shortLabel = labelText(input.shortLabel, 20, "Short map label");
  const visible = /[\p{L}\p{N}\p{P}\p{S}]/u;
  if (!visible.test(fullLabel))
    throw new ValidationError("REQUIRED", "Displayed marking", "Enter a visible displayed marking.");
  if (!visible.test(shortLabel))
    throw new ValidationError("REQUIRED", "Short map label", "Enter a visible short map label.");
  if (!isMarking(input.base))
    throw new ValidationError("INVALID_VALUE", "Display grouping", "Choose an existing display grouping.");
  return {
    fullLabel,
    shortLabel,
    base: input.base,
    description: labelText(input.description ?? "", 240, "Description") || null,
  };
}

/** Column order is shared by open validation, catalog reads, and assignment projection. */
export function parseStoredNetworkMarking(
  exchangeId: SqlValue | undefined,
  presetKey: SqlValue | undefined,
  fullLabel: SqlValue | undefined,
  shortLabel: SqlValue | undefined,
  base: SqlValue | undefined,
  description: SqlValue | undefined,
  normalized: SqlValue | undefined,
): NetworkMarking {
  if (
    typeof exchangeId !== "string" ||
    !UUID_V4.test(exchangeId) ||
    typeof fullLabel !== "string" ||
    typeof shortLabel !== "string" ||
    !isMarking(base) ||
    (description !== null && typeof description !== "string") ||
    normalized !== normalizeMarkingLabel(fullLabel)
  )
    throw new Error("Invalid network marking record.");

  if (typeof presetKey === "string") {
    const preset = findMarkingPreset(presetKey);
    if (
      preset?.fullLabel !== fullLabel ||
      preset.shortLabel !== shortLabel ||
      preset.base !== base ||
      preset.description !== description
    )
      throw new Error("Stored network marking preset differs from the catalog.");
    return preset;
  }
  const fields = validateMarkingFields({ fullLabel, shortLabel, base, description });
  if (
    presetKey !== null ||
    fields.fullLabel !== fullLabel ||
    fields.shortLabel !== shortLabel ||
    fields.description !== description ||
    MARKING_PRESETS.some((preset) => normalizeMarkingLabel(preset.fullLabel) === normalized)
  )
    throw new Error("Invalid custom network marking record.");

  return { source: "custom", key: exchangeId, ...fields };
}
