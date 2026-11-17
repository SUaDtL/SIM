import { isMarking, type Marking } from "../db/markings";
import { UUID_V4 } from "../domain/assessment-context";
import { ValidationError } from "../domain/errors";
import { cleanText } from "../domain/validate";

export const NOTE_BASES = ["unspecified", "reported", "configuration", "observed", "inferred"] as const;
export const REVIEW_STATES = ["needs review", "reviewed", "disputed"] as const;
export const FINDINGS = ["not assessed", "reported or present", "confirmed absent", "not applicable"] as const;
export const ASSERTIONS = {
  assessment: ["Scope"],
  service: [
    "Name",
    "Description",
    "Provider",
    "Tier 1 support",
    "Tier 2 support",
    "Tier 3 support",
    "Dependencies",
    "Consumers",
  ],
  service_dependency: ["Presence", "Route"],
  org_consumes: ["Presence"],
} as const;
export type TargetKind = keyof typeof ASSERTIONS;
export type NoteKind = "Evidence" | "Question";

export interface NoteTarget {
  readonly kind: TargetKind;
  readonly id: string | null;
  readonly label: string;
}

export interface NoteInput {
  readonly kind: NoteKind;
  readonly target: NoteTarget;
  readonly aspect: string;
  readonly text: string;
  readonly source: string;
  readonly responsible: string;
  readonly checkedOn: string;
  readonly basis: (typeof NOTE_BASES)[number];
  readonly state: (typeof REVIEW_STATES)[number] | "open" | "resolved";
  readonly finding: (typeof FINDINGS)[number];
  readonly resolution: string;
  readonly marking: Marking;
}

export interface AssessmentNote extends NoteInput {
  readonly id: string;
  readonly reviewedValue: string | null;
}
export interface ReadAssessmentNote extends AssessmentNote {
  readonly currentState: NoteInput["state"];
  readonly detached: boolean;
}

const refuse = (message: string): never => {
  throw new ValidationError("INVALID_VALUE", "assessment note", message);
};

export function validateNote(note: NoteInput): NoteInput {
  const allowed: readonly string[] = ASSERTIONS[note.target.kind];
  if (
    !allowed.includes(note.aspect) ||
    (note.target.kind === "assessment" ? note.target.id !== null : !UUID_V4.test(note.target.id ?? ""))
  ) {
    return refuse("Choose an existing assessment assertion.");
  }
  if (!isMarking(note.marking)) return refuse("Choose a valid marking.");
  const fields = ["text", "source", "responsible", "checkedOn", "resolution"] as const;
  const clean = { ...note };
  for (const field of fields) {
    const value = cleanText(note[field]) ?? "";
    if (value.length > 4000 || value.includes("\0")) return refuse("Use up to 4,000 characters per field.");
    clean[field] = value;
  }
  if (!clean.text) return refuse("Enter the evidence or question.");
  if (clean.checkedOn) {
    const date = new Date(clean.checkedOn + "T00:00:00.000Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(clean.checkedOn) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== clean.checkedOn
    )
      return refuse("Enter a valid checked-on date.");
  }
  if (!NOTE_BASES.includes(clean.basis) || !FINDINGS.includes(clean.finding))
    return refuse("Choose a valid basis and finding.");
  if (clean.kind === "Evidence") {
    if (clean.state === "open" || clean.state === "resolved" || !REVIEW_STATES.includes(clean.state))
      return refuse("Choose a valid evidence state.");
    if (clean.finding === "confirmed absent" && !clean.checkedOn)
      return refuse("A confirmed absence needs a checked-on date.");
  } else {
    if (clean.state !== "open" && clean.state !== "resolved") return refuse("Choose a valid question state.");
    if (clean.state === "resolved" && !clean.resolution) return refuse("A resolution needs a reason or source.");
  }
  return clean;
}

export function parseStoredNote(id: string, marking: Marking, payload: string): AssessmentNote {
  if (!UUID_V4.test(id) || payload.length > 40_000) return refuse("Invalid assessment note.");
  const value: unknown = JSON.parse(payload);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse("Invalid assessment note.");
  const row = value as Record<string, unknown>;
  const target = row["target"];
  if (typeof target !== "object" || target === null || Array.isArray(target))
    return refuse("Invalid assessment note target.");
  const ref = target as Record<string, unknown>;
  if (
    typeof ref["kind"] !== "string" ||
    !Object.hasOwn(ASSERTIONS, ref["kind"]) ||
    typeof ref["label"] !== "string" ||
    ref["label"].length > 4000 ||
    (ref["id"] !== null && typeof ref["id"] !== "string")
  )
    return refuse("Invalid assessment note target.");
  for (const key of [
    "kind",
    "aspect",
    "text",
    "source",
    "responsible",
    "checkedOn",
    "basis",
    "state",
    "finding",
    "resolution",
  ]) {
    if (typeof row[key] !== "string") return refuse("Invalid assessment note field.");
  }
  const reviewedValue = row["reviewedValue"];
  if (reviewedValue !== null && (typeof reviewedValue !== "string" || reviewedValue.length > 16000)) {
    return refuse("Invalid reviewed assertion value.");
  }
  if (row["kind"] !== "Evidence" && row["kind"] !== "Question") return refuse("Invalid assessment note type.");
  const input = row as unknown as NoteInput;
  return {
    ...validateNote({
      kind: input.kind,
      target: { kind: input.target.kind, id: input.target.id, label: input.target.label },
      aspect: input.aspect,
      text: input.text,
      source: input.source,
      responsible: input.responsible,
      checkedOn: input.checkedOn,
      basis: input.basis,
      state: input.state,
      finding: input.finding,
      resolution: input.resolution,
      marking,
    }),
    id,
    reviewedValue,
  };
}
