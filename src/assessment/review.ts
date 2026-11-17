import { bannerText, isMarking, type Marking } from "../db/markings";
import { newExchangeIdentity, UUID_V4, type ExchangeTable } from "../domain/assessment-context";
import type { Repository } from "../domain/repository";
import type { Tier } from "../domain/types";

export const REVIEW_FIELDS = [
  "description",
  "provider",
  "category",
  "application",
  "support1",
  "support2",
  "support3",
  "support1Notes",
  "support2Notes",
  "support3Notes",
] as const;
export type ReviewField = (typeof REVIEW_FIELDS)[number];
type ReviewValue = string | null;
type Fields = Record<ReviewField, ReviewValue>;
type ReferenceType = "organization" | "category" | "application";

export interface ReviewBase {
  readonly format: "sim-review/v1";
  readonly id: string;
  readonly lineage: string;
  readonly issuedAt: string;
  readonly marking: Marking;
  readonly caveat: string | null;
  readonly team: string;
  readonly services: readonly {
    readonly id: string;
    readonly label: string;
    readonly roles: readonly string[];
    readonly fields: Fields;
  }[];
  readonly references: readonly { readonly id: string; readonly label: string; readonly type: ReferenceType }[];
  readonly boundaries: readonly { readonly consumer: string; readonly provider: string; readonly kind: string }[];
}

export interface Issuance {
  readonly base: ReviewBase;
  readonly digest: string;
}

export interface Proposal {
  readonly service: string;
  readonly field: string;
  readonly operation: "set" | "clear";
  readonly value: ReviewValue;
}

interface ReturnedReview {
  readonly issuance: string;
  readonly lineage: string;
  readonly digest: string;
  readonly reviewer: string;
  readonly proposals: readonly Proposal[];
}

export type Disposition = "proposed" | "conflict" | "unchanged" | "already satisfied" | "quarantined";
export interface Difference {
  readonly proposal: Proposal;
  readonly key: string;
  readonly disposition: Disposition;
  readonly label: string;
  readonly base: ReviewValue;
  readonly current: ReviewValue;
  readonly returned: ReviewValue;
  readonly reason?: string;
}

export const MAX_REVIEW_BYTES = 2 * 1024 * 1024;

export async function reviewDigest(base: ReviewBase): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(base)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mappedIds(repo: Repository) {
  const cache = new Map<ExchangeTable, ReadonlyMap<string, string>>();
  return (table: ExchangeTable): ReadonlyMap<string, string> => {
    const loaded = cache.get(table) ?? repo.exchangeIdentities(table);
    cache.set(table, loaded);
    return loaded;
  };
}

function fieldValues(repo: Repository, id: number, ids: ReturnType<typeof mappedIds>): Fields {
  const row = repo.readServiceEditBase(id);
  const ref = (table: ReferenceType, value: number | null): ReviewValue =>
    value === null ? null : (ids(table).get(String(value)) ?? null);
  const support = (tier: number) => row.support.find((entry) => entry.tier === tier);
  return {
    description: row.service.description,
    provider: ref("organization", row.service.providerOrgId),
    category: ref("category", row.service.categoryId),
    application: ref("application", row.service.applicationId),
    support1: ref("organization", support(1)?.orgId ?? null),
    support2: ref("organization", support(2)?.orgId ?? null),
    support3: ref("organization", support(3)?.orgId ?? null),
    support1Notes: support(1)?.notes ?? null,
    support2Notes: support(2)?.notes ?? null,
    support3Notes: support(3)?.notes ?? null,
  };
}

function referenceType(field: string): ReferenceType | null {
  if (field === "category" || field === "application") return field;
  return field === "provider" || /^support[123]$/.test(field) ? "organization" : null;
}

export function prepareReview(repo: Repository, organizationId: number): ReviewBase {
  const snap = repo.snapshot();
  const team = repo.getOrganization(organizationId);
  if (!team) throw new Error("The selected organization is unavailable.");
  const ids = mappedIds(repo);
  const networkNames = new Map(snap.networks.map((row) => [row.id, row.name]));
  const labels = new Map(
    snap.services.map((row) => [row.id, `${row.name} (${networkNames.get(row.networkId) ?? "Unknown network"})`]),
  );
  const roles = new Map<number, string[]>();
  const add = (service: number, role: string): void => {
    const values = roles.get(service) ?? [];
    values.push(role);
    roles.set(service, values);
  };
  for (const row of snap.services) if (row.providerOrgId === organizationId) add(row.id, "Provider");
  for (const row of snap.support)
    if (row.orgId === organizationId) add(row.serviceId, `Tier ${String(row.tier)} support`);
  for (const row of snap.consumption) if (row.orgId === organizationId) add(row.serviceId, "Consuming organization");
  if (!roles.size || roles.size > 200)
    throw new Error("A review needs between 1 and 200 services with explicit roles for the chosen organization.");
  const included = new Set<string>();
  const services = [...roles.entries()].map(([serviceId, assigned]) => {
    const id = ids("service").get(String(serviceId));
    const label = labels.get(serviceId);
    if (!id || label === undefined) throw new Error("A review target is no longer available.");
    const fields = fieldValues(repo, serviceId, ids);
    for (const field of REVIEW_FIELDS) {
      const value = fields[field];
      if (referenceType(field) && value !== null) included.add(value);
    }
    return { id, label, roles: assigned, fields };
  });
  const teamId = ids("organization").get(String(organizationId));
  if (teamId) included.add(teamId);
  const references = (["organization", "category", "application"] as const).flatMap((type) => {
    const rows =
      type === "organization" ? snap.organizations : type === "category" ? snap.categories : snap.applications;
    return rows.flatMap((row) => {
      const id = ids(type).get(String(row.id));
      return id && included.has(id) ? [{ type, id, label: row.name }] : [];
    });
  });
  const boundaries = snap.dependencies.flatMap((row) => {
    const from = roles.has(row.consumerServiceId);
    const to = roles.has(row.providerServiceId);
    if (!from && !to) return [];
    return [
      {
        consumer: labels.get(row.consumerServiceId) ?? "Unavailable",
        provider: labels.get(row.providerServiceId) ?? "Unavailable",
        kind: row.viaCdsId === null ? "Recorded; no CDS in this row" : "Recorded with a CDS",
      },
    ];
  });
  if (boundaries.length > 1000) throw new Error("The review has more than 1,000 related rows.");
  return {
    format: "sim-review/v1",
    id: newExchangeIdentity(),
    lineage: repo.assessmentContext().lineage,
    issuedAt: new Date().toISOString(),
    marking: snap.marking,
    caveat: snap.caveat,
    team: team.name,
    services,
    references,
    boundaries,
  };
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (row: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key));

const uuid = (value: unknown): value is string => typeof value === "string" && UUID_V4.test(value);
const digestId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const brief = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length <= limit && !value.includes("\0");

export function parseReviewBase(text: string): ReviewBase {
  if (new TextEncoder().encode(text).length > MAX_REVIEW_BYTES) throw new Error("Review base is too large.");
  const row: unknown = JSON.parse(text);
  if (
    !object(row) ||
    !exactKeys(row, [
      "format",
      "id",
      "lineage",
      "issuedAt",
      "marking",
      "caveat",
      "team",
      "services",
      "references",
      "boundaries",
    ]) ||
    row["format"] !== "sim-review/v1" ||
    !uuid(row["id"]) ||
    !uuid(row["lineage"]) ||
    !brief(row["team"], 200) ||
    !brief(row["issuedAt"], 30) ||
    !isMarking(row["marking"]) ||
    (row["caveat"] !== null && !brief(row["caveat"], 80))
  )
    throw new Error("Invalid local review base.");
  const services: unknown = row["services"];
  const refs: unknown = row["references"];
  const boundaries: unknown = row["boundaries"];
  if (
    !Array.isArray(services) ||
    !services.length ||
    services.length > 200 ||
    !Array.isArray(refs) ||
    refs.length > 1500 ||
    !Array.isArray(boundaries) ||
    boundaries.length > 1000
  ) {
    throw new Error("Invalid local review scope.");
  }
  for (const service of services as unknown[]) {
    if (
      !object(service) ||
      !exactKeys(service, ["id", "label", "roles", "fields"]) ||
      !uuid(service["id"]) ||
      !brief(service["label"], 600) ||
      !Array.isArray(service["roles"]) ||
      service["roles"].length > 5 ||
      !(service["roles"] as unknown[]).every((item) => brief(item, 40)) ||
      !object(service["fields"])
    )
      throw new Error("Invalid local review service.");
    const fields = service["fields"];
    if (
      !exactKeys(fields, REVIEW_FIELDS) ||
      !REVIEW_FIELDS.every(
        (field) => fields[field] === null || (referenceType(field) ? uuid(fields[field]) : brief(fields[field], 4000)),
      )
    )
      throw new Error("Invalid base value.");
  }
  for (const ref of refs as unknown[]) {
    if (
      !object(ref) ||
      !exactKeys(ref, ["id", "label", "type"]) ||
      !uuid(ref["id"]) ||
      !brief(ref["label"], 200) ||
      !["organization", "category", "application"].includes(String(ref["type"]))
    )
      throw new Error("Invalid base reference.");
  }
  for (const edge of boundaries as unknown[]) {
    if (!object(edge) || !brief(edge["consumer"], 600) || !brief(edge["provider"], 600) || !brief(edge["kind"], 80)) {
      throw new Error("Invalid review boundary context.");
    }
  }
  return row as unknown as ReviewBase;
}

export function renderReviewPack({ base, digest }: Issuance): string {
  return JSON.stringify(
    {
      format: "sim-corrections/v1",
      lineage: base.lineage,
      issuance: base.id,
      digest,
      reviewer: "",
      marking: bannerText(base.marking, base.caveat),
      review: base,
      instructions: [
        "Review the services and roles in this package. Boundary rows include endpoint labels only.",
        "Add proposed changes to proposals. Each has service (the exact ID), field, operation (set or clear), and value (string or null for clear).",
        "Omit a field to make no proposal. Set shared references using IDs from references of the applicable type.",
        "The assessment owner chooses which proposals to apply. Return the file through an approved local process.",
      ],
      proposals: [],
    },
    null,
    2,
  );
}

export function parseReturn(text: string): ReturnedReview {
  if (new TextEncoder().encode(text).length > MAX_REVIEW_BYTES) throw new Error("Review file exceeds the 2 MB limit.");
  const row: unknown = JSON.parse(text);
  if (
    !object(row) ||
    row["format"] !== "sim-corrections/v1" ||
    !uuid(row["issuance"]) ||
    !uuid(row["lineage"]) ||
    !digestId(row["digest"]) ||
    !brief(row["reviewer"], 200) ||
    !Array.isArray(row["proposals"]) ||
    row["proposals"].length > 1000
  )
    throw new Error("Invalid or unsupported correction file.");
  const proposals = (row["proposals"] as unknown[]).map((item): Proposal => {
    if (
      !object(item) ||
      !uuid(item["service"]) ||
      !brief(item["field"], 80) ||
      (item["operation"] === "set"
        ? !brief(item["value"], 4000)
        : item["operation"] !== "clear" || item["value"] !== null)
    )
      throw new Error("Invalid set or clear proposal.");
    return {
      service: item["service"],
      field: item["field"],
      operation: item["operation"] === "set" ? "set" : "clear",
      value: item["value"] as ReviewValue,
    };
  });
  const keys = proposals.map(({ service, field }) => `${service}:${field}`);
  if (new Set(keys).size !== keys.length) throw new Error("A correction field was proposed more than once.");
  return {
    issuance: row["issuance"],
    lineage: row["lineage"],
    digest: row["digest"],
    reviewer: row["reviewer"],
    proposals,
  };
}

export function classifyDifference(base: ReviewValue, current: ReviewValue, returned: ReviewValue): Disposition {
  if (base === returned) return "unchanged";
  if (current === returned) return "already satisfied";
  return current === base ? "proposed" : "conflict";
}

export function prepareCorrections(repo: Repository, issuance: Issuance, returned: ReturnedReview): Difference[] {
  if (
    issuance.base.id !== returned.issuance ||
    issuance.digest !== returned.digest ||
    issuance.base.lineage !== returned.lineage ||
    repo.assessmentContext().lineage !== returned.lineage
  ) {
    throw new Error(
      "This return cannot be matched to its issuing saved base. Use the explicit editor to compare any suggestions manually.",
    );
  }
  const ids = mappedIds(repo);
  const services = new Map([...ids("service")].map(([id, identity]) => [identity, Number(id)]));
  const scoped = new Map(issuance.base.services.map((row) => [row.id, row]));
  const byService = new Map<string, Fields>();
  return returned.proposals.map((proposal) => {
    const key = `${proposal.service}:${proposal.field}`;
    const scope = scoped.get(proposal.service);
    const service = services.get(proposal.service);
    const base = {
      proposal,
      key,
      label: scope?.label ?? proposal.service,
      base: null,
      current: null,
      returned: proposal.value,
    };
    if (service === undefined || !scope || !(REVIEW_FIELDS as readonly string[]).includes(proposal.field)) {
      return {
        ...base,
        disposition: "quarantined",
        reason: "Target or field was deleted, unsupported, or outside the issued scope.",
      };
    }
    const field = proposal.field as ReviewField;
    if (proposal.value !== null && (proposal.value.length === 0 || proposal.value.trim() !== proposal.value)) {
      return {
        ...base,
        disposition: "quarantined",
        reason: "Set requires a nonempty value without outer whitespace. Use an explicit clear to remove a value.",
      };
    }
    const ref = referenceType(field);
    if (
      ref &&
      proposal.value !== null &&
      (!issuance.base.references.some((row) => row.type === ref && row.id === proposal.value) ||
        ![...ids(ref).values()].includes(proposal.value))
    ) {
      return {
        ...base,
        disposition: "quarantined",
        reason: "The proposed shared record is unavailable or outside the issued scope.",
      };
    }
    const fields = byService.get(proposal.service) ?? fieldValues(repo, service, ids);
    byService.set(proposal.service, fields);
    return {
      ...base,
      base: scope.fields[field],
      current: fields[field],
      disposition: classifyDifference(scope.fields[field], fields[field], proposal.value),
    };
  });
}

export function applyCorrections(
  repo: Repository,
  issuance: Issuance,
  returned: ReturnedReview,
  accepted: readonly Difference[],
  confirmSensitive = false,
): number {
  return repo.atomic(() => {
    const trusted = repo.reviewIssuance(issuance.base.id);
    if (!trusted || JSON.stringify(trusted) !== JSON.stringify(issuance))
      throw new Error("The trusted review base is unavailable.");
    const fresh = new Map(prepareCorrections(repo, issuance, returned).map((row) => [row.key, row]));
    const ids = mappedIds(repo);
    const find = (table: ExchangeTable, identity: string | null): number | null => {
      if (identity === null) return null;
      for (const [key, value] of ids(table)) if (value === identity) return Number(key);
      throw new Error("A selected identity is no longer available.");
    };
    const selected = new Map<number, Difference[]>();
    for (const row of accepted) {
      const now = fresh.get(row.key);
      if (
        !now ||
        (now.disposition !== "proposed" && now.disposition !== "conflict") ||
        now.current !== row.current ||
        now.returned !== row.returned ||
        now.disposition !== row.disposition
      ) {
        throw new Error(`${row.label} changed after preview. Review the return again before applying.`);
      }
      const service = find("service", row.proposal.service);
      if (service === null) throw new Error("A selected service is no longer available.");
      const values = selected.get(service) ?? [];
      values.push(row);
      selected.set(service, values);
    }
    for (const [id, rows] of selected) {
      const service = repo.readServiceEditBase(id);
      const fields = new Map(rows.map((row) => [row.proposal.field, row.returned]));
      const base = service.service;
      const read = (field: ReviewField, current: ReviewValue): ReviewValue =>
        fields.has(field) ? (fields.get(field) ?? null) : current;
      const updateRef = (field: ReviewField, current: number | null, type: ReferenceType): number | null =>
        fields.has(field) ? find(type, fields.get(field) ?? null) : current;
      if (["description", "provider", "category", "application"].some((field) => fields.has(field))) {
        const description = read("description", base.description);
        if (description !== null && description.trim() !== description)
          throw new Error("Descriptions cannot have leading or trailing whitespace.");
        repo.updateService(
          id,
          {
            ...base,
            description,
            providerOrgId: updateRef("provider", base.providerOrgId, "organization"),
            categoryId: updateRef("category", base.categoryId, "category"),
            applicationId: updateRef("application", base.applicationId, "application"),
          },
          { confirmSensitive },
        );
      }
      for (const tier of [1, 2, 3] as const satisfies readonly Tier[]) {
        const role = `support${String(tier)}` as ReviewField;
        const detail = `support${String(tier)}Notes` as ReviewField;
        if (!fields.has(role) && !fields.has(detail)) continue;
        const before = service.support.find((row) => row.tier === tier);
        const orgId = updateRef(role, before?.orgId ?? null, "organization");
        const notes = read(detail, before?.notes ?? null);
        if (orgId === null && notes !== null)
          throw new Error(`${base.name}: clearing the support assignment would also clear notes. Review both fields.`);
        repo.setSupport(id, tier, orgId, notes, { confirmSensitive });
      }
    }
    return accepted.length;
  });
}
