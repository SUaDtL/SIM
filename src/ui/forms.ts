import { MARKINGS, type Marking } from "../db/markings";
import { ValidationError } from "../domain/errors";
import { cleanName } from "../domain/validate";
import type { Repository } from "../domain/repository";
import type { NetworkKind, ServiceInput, WriteOptions } from "../domain/types";

export const ENTITY_TYPES = [
  "network",
  "service",
  "organization",
  "application",
  "category",
  "cds",
  "scenario",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Raw form state: text and select values are strings ("" = none), checkboxes booleans, checklists id strings. */
export type FormValues = Record<string, string | boolean | string[]>;

export interface Option {
  readonly value: string;
  readonly label: string;
}

export interface FieldDef {
  readonly key: string;
  readonly label: string;
  readonly kind: "text" | "textarea" | "select" | "checkbox" | "checklist" | "color";
  readonly required?: boolean;
  /** For an optional select, the label of its empty choice. */
  readonly none?: string;
  /** Choices for select and checklist fields; `editingId` lets a form exclude the item being edited. */
  readonly options?: (repo: Repository, editingId: number | null) => Option[];
}

export interface ListItem {
  readonly id: number;
  readonly name: string;
  readonly detail: string;
}

export interface EntityDescriptor {
  readonly type: EntityType;
  readonly label: string;
  readonly plural: string;
  readonly fields: readonly FieldDef[];
  list(repo: Repository): ListItem[];
  get(repo: Repository, id: number): unknown;
  /** Form values for an existing item, or defaults for a new one (`id` null). */
  values(repo: Repository, id: number | null): FormValues;
  /** Create (`id` null) or replace every field of an item; returns its id. */
  save(repo: Repository, id: number | null, values: FormValues, options?: WriteOptions): number;
  remove(repo: Repository, id: number): void;
  /** Repository error `field` strings mapped to this form's field keys. */
  readonly errorFields: Readonly<Record<string, string>>;
}

const KINDS: Option[] = [
  { value: "internal", label: "Internal network" },
  { value: "external", label: "External (SaaS / third party)" },
];
const markingOptions = (): Option[] => MARKINGS.map((m) => ({ value: m, label: m }));
const networkOptions = (repo: Repository): Option[] =>
  repo.listNetworks().map((n) => ({ value: String(n.id), label: n.name }));
const orgOptions = (repo: Repository, exclude: number | null = null): Option[] =>
  repo
    .listOrganizations()
    .filter((o) => o.id !== exclude)
    .map((o) => ({ value: String(o.id), label: o.name }));

const NAME: FieldDef = { key: "name", label: "Name", kind: "text", required: true };
const DESCRIPTION: FieldDef = { key: "description", label: "Description", kind: "textarea" };

function str(values: FormValues, key: string): string {
  const v = values[key];
  return typeof v === "string" ? v : "";
}

function ref(values: FormValues, key: string): number | null {
  const v = str(values, key);
  return v === "" ? null : Number(v);
}

function ids(values: FormValues, key: string): number[] {
  const v = values[key];
  return Array.isArray(v) ? v.map(Number) : [];
}

const idString = (id: number | null): string => (id === null ? "" : String(id));

/** The repository revalidates kind and marking, so an unchecked cast cannot store a bad value. */
const asKind = (v: string): NetworkKind => v as NetworkKind;
const asMarking = (v: string): Marking => v as Marking;

export function serviceInputFromValues(v: FormValues): ServiceInput {
  const networkId = ref(v, "networkId");
  if (networkId === null) {
    cleanName(str(v, "name"), "service name");
    throw new ValidationError("REQUIRED", "network", "Choose a network for this service.");
  }
  return {
    name: str(v, "name"),
    networkId,
    marking: asMarking(str(v, "marking")),
    providerOrgId: ref(v, "providerOrgId"),
    applicationId: ref(v, "applicationId"),
    categoryId: ref(v, "categoryId"),
    foundational: v["foundational"] === true,
    description: str(v, "description"),
  };
}

const network: EntityDescriptor = {
  type: "network",
  label: "Network",
  plural: "Networks",
  fields: [
    NAME,
    { key: "kind", label: "Kind", kind: "select", options: () => KINDS },
    { key: "marking", label: "Marking", kind: "select", options: markingOptions },
    DESCRIPTION,
  ],
  list: (repo) => repo.listNetworks().map((n) => ({ id: n.id, name: n.name, detail: `${n.marking} · ${n.kind}` })),
  get: (repo, id) => repo.getNetwork(id),
  values(repo, id) {
    const n = id === null ? undefined : repo.getNetwork(id);
    return {
      name: n?.name ?? "",
      kind: n?.kind ?? "internal",
      marking: n?.marking ?? "UNCLASSIFIED",
      description: n?.description ?? "",
    };
  },
  save(repo, id, v, options) {
    const input = {
      name: str(v, "name"),
      kind: asKind(str(v, "kind")),
      marking: asMarking(str(v, "marking")),
      description: str(v, "description"),
    };
    return (id === null ? repo.createNetwork(input, options) : repo.updateNetwork(id, input, options)).id;
  },
  remove: (repo, id) => {
    repo.deleteNetwork(id);
  },
  errorFields: { "network name": "name", kind: "kind", marking: "marking", description: "description" },
};

const service: EntityDescriptor = {
  type: "service",
  label: "Service",
  plural: "Services",
  fields: [
    NAME,
    {
      key: "networkId",
      label: "Network",
      kind: "select",
      required: true,
      none: "Choose a network",
      options: networkOptions,
    },
    { key: "marking", label: "Marking", kind: "select", options: markingOptions },
    {
      key: "providerOrgId",
      label: "Provided by",
      kind: "select",
      none: "(no provider)",
      options: (r) => orgOptions(r),
    },
    {
      key: "applicationId",
      label: "Application",
      kind: "select",
      none: "(none)",
      options: (r) => r.listApplications().map((a) => ({ value: String(a.id), label: a.name })),
    },
    {
      key: "categoryId",
      label: "Category",
      kind: "select",
      none: "(none)",
      options: (r) => r.listCategories().map((c) => ({ value: String(c.id), label: c.name })),
    },
    { key: "foundational", label: "Foundational (e.g. identity, DNS)", kind: "checkbox" },
    DESCRIPTION,
  ],
  list(repo) {
    const networks = new Map(repo.listNetworks().map((n) => [n.id, n.name]));
    return repo
      .listServices()
      .map((s) => ({ id: s.id, name: s.name, detail: `${networks.get(s.networkId) ?? "?"} · ${s.marking}` }));
  },
  get: (repo, id) => repo.getService(id),
  values(repo, id) {
    const s = id === null ? undefined : repo.getService(id);
    return {
      name: s?.name ?? "",
      networkId: idString(s?.networkId ?? null),
      marking: s?.marking ?? "UNCLASSIFIED",
      providerOrgId: idString(s?.providerOrgId ?? null),
      applicationId: idString(s?.applicationId ?? null),
      categoryId: idString(s?.categoryId ?? null),
      foundational: s?.foundational ?? false,
      description: s?.description ?? "",
    };
  },
  save(repo, id, v, options) {
    const input = serviceInputFromValues(v);
    return (id === null ? repo.createService(input, options) : repo.updateService(id, input, options)).id;
  },
  remove: (repo, id) => {
    repo.deleteService(id);
  },
  errorFields: {
    "service name": "name",
    network: "networkId",
    marking: "marking",
    provider: "providerOrgId",
    application: "applicationId",
    category: "categoryId",
    description: "description",
  },
};

const organization: EntityDescriptor = {
  type: "organization",
  label: "Organization",
  plural: "Organizations",
  fields: [
    NAME,
    { key: "parentId", label: "Part of", kind: "select", none: "(top level)", options: (r, id) => orgOptions(r, id) },
  ],
  list(repo) {
    const orgs = repo.listOrganizations();
    const names = new Map(orgs.map((o) => [o.id, o.name]));
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      detail: o.parentId === null ? "" : `part of ${names.get(o.parentId) ?? "?"}`,
    }));
  },
  get: (repo, id) => repo.getOrganization(id),
  values(repo, id) {
    const o = id === null ? undefined : repo.getOrganization(id);
    return { name: o?.name ?? "", parentId: idString(o?.parentId ?? null) };
  },
  save(repo, id, v, options) {
    const input = { name: str(v, "name"), parentId: ref(v, "parentId") };
    return (id === null ? repo.createOrganization(input, options) : repo.updateOrganization(id, input, options)).id;
  },
  remove: (repo, id) => {
    repo.deleteOrganization(id);
  },
  errorFields: { "organization name": "name", parent: "parentId" },
};

const application: EntityDescriptor = {
  type: "application",
  label: "Application",
  plural: "Applications",
  fields: [NAME, { key: "vendor", label: "Vendor", kind: "text" }, DESCRIPTION],
  list: (repo) => repo.listApplications().map((a) => ({ id: a.id, name: a.name, detail: a.vendor ?? "" })),
  get: (repo, id) => repo.getApplication(id),
  values(repo, id) {
    const a = id === null ? undefined : repo.getApplication(id);
    return { name: a?.name ?? "", vendor: a?.vendor ?? "", description: a?.description ?? "" };
  },
  save(repo, id, v, options) {
    const input = { name: str(v, "name"), vendor: str(v, "vendor"), description: str(v, "description") };
    return (id === null ? repo.createApplication(input, options) : repo.updateApplication(id, input, options)).id;
  },
  remove: (repo, id) => {
    repo.deleteApplication(id);
  },
  errorFields: { "application name": "name", vendor: "vendor", description: "description" },
};

const category: EntityDescriptor = {
  type: "category",
  label: "Category",
  plural: "Categories",
  fields: [NAME, { key: "color", label: "Color", kind: "color" }],
  list: (repo) => repo.listCategories().map((c) => ({ id: c.id, name: c.name, detail: c.color ?? "" })),
  get: (repo, id) => repo.getCategory(id),
  values(repo, id) {
    const c = id === null ? undefined : repo.getCategory(id);
    return { name: c?.name ?? "", color: c?.color ?? "" };
  },
  save(repo, id, v, options) {
    const input = { name: str(v, "name"), color: str(v, "color") };
    return (id === null ? repo.createCategory(input, options) : repo.updateCategory(id, input, options)).id;
  },
  remove: (repo, id) => {
    repo.deleteCategory(id);
  },
  errorFields: { "category name": "name", color: "color" },
};

const cds: EntityDescriptor = {
  type: "cds",
  label: "CDS",
  plural: "CDS",
  fields: [
    NAME,
    { key: "networkIds", label: "Joins networks", kind: "checklist", options: networkOptions },
    DESCRIPTION,
  ],
  list(repo) {
    const networks = new Map(repo.listNetworks().map((n) => [n.id, n.name]));
    return repo.listCds().map((c) => ({
      id: c.id,
      name: c.name,
      detail: c.networkIds.map((n) => networks.get(n) ?? "?").join(" ↔ "),
    }));
  },
  get: (repo, id) => repo.getCds(id),
  values(repo, id) {
    const c = id === null ? undefined : repo.getCds(id);
    return { name: c?.name ?? "", networkIds: (c?.networkIds ?? []).map(String), description: c?.description ?? "" };
  },
  save(repo, id, v, options) {
    const input = { name: str(v, "name"), networkIds: ids(v, "networkIds"), description: str(v, "description") };
    return (id === null ? repo.createCds(input, options) : repo.updateCds(id, input, options)).id;
  },
  remove: (repo, id) => {
    repo.deleteCds(id);
  },
  errorFields: { "CDS name": "name", networks: "networkIds", description: "description" },
};

/** A To-Be scenario (WORK-013); its changes are relationship rows in the editor. */
const scenario: EntityDescriptor = {
  type: "scenario",
  label: "Scenario",
  plural: "Scenarios",
  fields: [NAME, DESCRIPTION],
  list: (repo) => {
    const changes = repo.listScenarioChanges();
    return repo.listScenarios().map((x) => {
      const n = changes.filter((c) => c.scenarioId === x.id).length;
      return { id: x.id, name: x.name, detail: `${String(n)} ${n === 1 ? "change" : "changes"}` };
    });
  },
  get: (repo, id) => repo.getScenario(id),
  values(repo, id) {
    const x = id === null ? undefined : repo.getScenario(id);
    return { name: x?.name ?? "", description: x?.description ?? "" };
  },
  save(repo, id, v, options) {
    const input = { name: str(v, "name"), description: str(v, "description") };
    return (id === null ? repo.createScenario(input, options) : repo.updateScenario(id, input, options)).id;
  },
  remove: (repo, id) => {
    repo.deleteScenario(id);
  },
  errorFields: { "scenario name": "name", description: "description" },
};

const DESCRIPTORS: Record<EntityType, EntityDescriptor> = {
  network,
  service,
  organization,
  application,
  category,
  cds,
  scenario,
};

export function descriptor(type: EntityType): EntityDescriptor {
  return DESCRIPTORS[type];
}

/** The noun used in button and heading text: "network", "service", ..., "CDS". */
export function nounOf(type: EntityType): string {
  return type === "cds" ? "CDS" : DESCRIPTORS[type].label.toLowerCase();
}

/** The form key to highlight for a repository error field, or null for an error about the whole item. */
export function fieldFor(type: EntityType, field: string): string | null {
  return DESCRIPTORS[type].errorFields[field] ?? null;
}

const FOUNDATIONAL_NAMES = new Set(["identity", "dns"]);

/** A new service with one of these names starts out foundational (Q-021); the user can untick it. */
export function suggestsFoundational(name: string): boolean {
  return FOUNDATIONAL_NAMES.has(name.trim().toLowerCase());
}
