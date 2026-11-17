import type { Marking } from "../db/markings";
import { ValidationError } from "./errors";
import { cleanText } from "./validate";

export const ASSESSMENT_FIELDS = {
  description: "Assessment description",
  scope: "Scope",
  exclusions: "Exclusions",
  assessor: "Assessor or team",
  startedOn: "Period start",
  asOf: "As of",
} as const;

export type AssessmentField = keyof typeof ASSESSMENT_FIELDS;
export type AssessmentContextInput = Record<AssessmentField, string | null>;
export interface AssessmentContext extends AssessmentContextInput {
  readonly lineage: string;
  readonly marking: Marking | null;
}

export const ASSESSMENT_FIELDS_LIST = Object.keys(ASSESSMENT_FIELDS) as AssessmentField[];
export const ASSESSMENT_TEXT_LIMIT = 4000;
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newExchangeIdentity(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function validateAssessmentContext(input: AssessmentContextInput): AssessmentContextInput {
  const result = { ...input };
  for (const field of ASSESSMENT_FIELDS_LIST) {
    const value = cleanText(input[field]);
    const label = ASSESSMENT_FIELDS[field];
    if (value !== null && (value.length > ASSESSMENT_TEXT_LIMIT || value.includes("\0"))) {
      throw new ValidationError(
        "INVALID_VALUE",
        field,
        `${label} must be at most ${String(ASSESSMENT_TEXT_LIMIT)} characters and contain no null characters.`,
      );
    }
    if ((field === "startedOn" || field === "asOf") && value !== null) {
      const date = new Date(value + "T00:00:00.000Z");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(date.valueOf()) ||
        date.toISOString().slice(0, 10) !== value
      ) {
        throw new ValidationError("INVALID_VALUE", field, `${label} must be a valid calendar date.`);
      }
    }
    result[field] = value;
  }
  if (result.startedOn !== null && result.asOf !== null && result.startedOn > result.asOf) {
    throw new ValidationError("INVALID_VALUE", "asOf", "As of must be on or after the period start.");
  }
  return result;
}

export const EXCHANGE_KEYS = {
  application: ["id"],
  category: ["id"],
  cds: ["id"],
  cds_network: ["cds_id", "network_id"],
  network: ["id"],
  org_consumes: ["org_id", "service_id"],
  organization: ["id"],
  scenario: ["id"],
  scenario_change: ["id"],
  service: ["id"],
  service_dependency: ["consumer_service_id", "provider_service_id"],
  support_assignment: ["service_id", "tier"],
} as const;
export type ExchangeTable = keyof typeof EXCHANGE_KEYS;
export const EXCHANGE_TABLES = Object.keys(EXCHANGE_KEYS) as ExchangeTable[];
