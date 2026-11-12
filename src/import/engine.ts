import { isMarking, type Marking, MARKINGS } from "../db/markings";
import { SensitiveInputWarning, ValidationError } from "../domain/errors";
import type { Repository } from "../domain/repository";
import type { Snapshot, Tier, WriteOptions } from "../domain/types";
import { suggestsFoundational } from "../ui/forms";
import { IMPORT_ORDER, type TemplateFile, type TemplateRow, type TemplateType } from "./templates";

/**
 * Apply template files to a repository (WORK-011). The same function makes the preview (against a
 * throwaway copy of the dataset) and the real import, so the preview is exactly what will happen.
 * Rows are written through the repository, so every validation rule applies; records that already
 * exist are reported and left alone, never overwritten.
 */
export interface ImportOptions {
  /** Import rows whose text looks like an IP address or host name (Q-032); off unless chosen. */
  readonly includeFlagged: boolean;
}

export interface RowNote {
  readonly file: string;
  readonly row: number;
  readonly message: string;
}

export interface ImportReport {
  /** Records created or links added, by template type. */
  readonly added: Readonly<Partial<Record<TemplateType, number>>>;
  readonly present: readonly RowNote[];
  readonly rejected: readonly RowNote[];
  /** Rows with host-like text: imported only when includeFlagged was set. */
  readonly flagged: readonly RowNote[];
}

interface EffectChange<T> {
  readonly key: string;
  readonly before: T | null;
  readonly after: T | null;
}

type ImportRows = Exclude<keyof Snapshot, "marking" | "caveat">;

/** Exact row and reference changes caused by this import, separate from unrelated dataset content. */
export type ImportEffect = {
  readonly [K in ImportRows]: readonly EffectChange<Snapshot[K][number]>[];
};

export interface ImportPreview {
  readonly report: ImportReport;
  readonly effect: ImportEffect;
}

export interface PreparedImport extends ImportPreview {
  readonly files: readonly TemplateFile[];
  readonly options: ImportOptions;
}

export class ImportConflictError extends Error {
  constructor() {
    super("The dataset changed in a way that affects this import. Review the updated preview before importing.");
    this.name = "ImportConflictError";
  }
}

function changedRows<T>(before: readonly T[], after: readonly T[], key: (row: T) => string): EffectChange<T>[] {
  const old = new Map(before.map((row) => [key(row), row]));
  const next = new Map(after.map((row) => [key(row), row]));
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((id) => {
    const previous = old.get(id) ?? null;
    const current = next.get(id) ?? null;
    return JSON.stringify(previous) === JSON.stringify(current) ? [] : [{ key: id, before: previous, after: current }];
  });
}

/** Snapshot contains every table that the append-only CSV engine may write. */
export function importEffect(before: Snapshot, after: Snapshot): ImportEffect {
  const id = (row: { readonly id: number }) => String(row.id);
  return {
    networks: changedRows(before.networks, after.networks, id),
    services: changedRows(before.services, after.services, id),
    cds: changedRows(before.cds, after.cds, id),
    organizations: changedRows(before.organizations, after.organizations, id),
    applications: changedRows(before.applications, after.applications, id),
    categories: changedRows(before.categories, after.categories, id),
    support: changedRows(before.support, after.support, (row) => `${String(row.serviceId)}|${String(row.tier)}`),
    consumption: changedRows(
      before.consumption,
      after.consumption,
      (row) => `${String(row.orgId)}|${String(row.serviceId)}`,
    ),
    dependencies: changedRows(
      before.dependencies,
      after.dependencies,
      (row) => `${String(row.consumerServiceId)}|${String(row.providerServiceId)}`,
    ),
    positions: changedRows(before.positions, after.positions, (row) => `${row.entity}|${String(row.id)}`),
    scenarios: changedRows(before.scenarios, after.scenarios, id),
    scenarioChanges: changedRows(before.scenarioChanges, after.scenarioChanges, id),
  };
}

/** Run against a throwaway repository to capture the exact reviewed result. */
export function prepareImport(repo: Repository, files: readonly TemplateFile[], options: ImportOptions): ImportPreview {
  const before = repo.snapshot();
  const report = runImport(repo, files, options);
  return { report, effect: importEffect(before, repo.snapshot()) };
}

/** Replay and compare inside one transaction, so a changed meaning rolls back before COMMIT. */
export function commitPreparedImport(repo: Repository, prepared: PreparedImport): ImportReport {
  return repo.atomic(() => {
    const before = repo.snapshot();
    const report = runImport(repo, prepared.files, prepared.options);
    const effect = importEffect(before, repo.snapshot());
    if (
      JSON.stringify(report) !== JSON.stringify(prepared.report) ||
      JSON.stringify(effect) !== JSON.stringify(prepared.effect)
    ) {
      throw new ImportConflictError();
    }
    return report;
  });
}

// SQLite NOCASE folds ASCII A-Z only. JavaScript's Unicode lowercasing merges
// distinct stored names such as Ä and ä, and can misdirect imported links.
const asciiNoCase = (value: string): string => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const key = (name: string): string => asciiNoCase(name);

class Rejected extends Error {}

function yesNo(value: string, field: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (v === "") return null;
  if (["yes", "y", "true", "1"].includes(v)) return true;
  if (["no", "n", "false", "0"].includes(v)) return false;
  throw new Rejected(`${field} must be yes or no, not "${value}".`);
}

function marking(value: string): Marking {
  const m = value.trim().toUpperCase().replace(/\s+/g, " ");
  if (!isMarking(m)) throw new Rejected(`Marking must be one of ${MARKINGS.join(", ")}, not "${value}".`);
  return m;
}

export function runImport(repo: Repository, files: readonly TemplateFile[], options: ImportOptions): ImportReport {
  const added: Partial<Record<TemplateType, number>> = {};
  const present: RowNote[] = [];
  const rejected: RowNote[] = [];
  const flagged: RowNote[] = [];

  // Stored names use exact bytes with SQLite's ASCII-only NOCASE collation.
  // A reference first tries its exact spelling, then the canonical spelling
  // that current authoring would produce from incidental surrounding spaces.
  const snap = repo.snapshot();
  const networks = new Map(snap.networks.map((n) => [key(n.name), n.id]));
  const orgs = new Map(snap.organizations.map((o) => [key(o.name), o.id]));
  const categories = new Map(snap.categories.map((c) => [key(c.name), c.id]));
  const applications = new Map(snap.applications.map((a) => [key(a.name), a.id]));
  const cds = new Map(snap.cds.map((c) => [key(c.name), c.id]));
  const services = new Map(snap.services.map((s) => [`${String(s.networkId)}|${key(s.name)}`, s.id]));
  const support = new Map(snap.support.map((s) => [`${String(s.serviceId)}|${String(s.tier)}`, s.orgId]));
  const consumers = new Set(snap.consumption.map((c) => `${String(c.orgId)}|${String(c.serviceId)}`));
  const dependencies = new Set(
    snap.dependencies.map((d) => `${String(d.consumerServiceId)}|${String(d.providerServiceId)}`),
  );
  /** Where a record was first seen in this import, to report repeats as such. */
  const seenAt = new Map<string, string>();

  const lookup = (map: Map<string, number>, name: string): number | undefined =>
    map.get(key(name)) ?? map.get(key(name.trim()));
  const existingNew = (map: Map<string, number>, name: string): boolean => map.has(key(name.trim()));
  const serviceId = (networkId: number, name: string): number | undefined =>
    services.get(`${String(networkId)}|${key(name)}`) ?? services.get(`${String(networkId)}|${key(name.trim())}`);
  const ref = (map: Map<string, number>, name: string, what: string): number => {
    const id = lookup(map, name);
    if (id === undefined) throw new Rejected(`No ${what} named "${name}".`);
    return id;
  };
  const optionalRef = (map: Map<string, number>, name: string, what: string): number | null =>
    name.trim() === "" ? null : ref(map, name, what);
  const service = (name: string, network: string): number => {
    const networkId = ref(networks, network, "network");
    const id = serviceId(networkId, name);
    if (id === undefined) throw new Rejected(`No service named "${name}" on ${network}.`);
    return id;
  };
  const count = (type: TemplateType) => {
    added[type] = (added[type] ?? 0) + 1;
  };

  /**
   * Run one row: `exists` names an existing record (reported, not changed); `write` makes it, with
   * confirmSensitive set only when host-like rows were chosen.
   */
  const apply = (
    file: TemplateFile,
    row: TemplateRow,
    exists: () => string | null,
    write: (options: WriteOptions) => void,
  ) => {
    const at = { file: file.name, row: row.row };
    try {
      if (row.overflow) throw new Rejected("The row has more values than the header has columns.");
      const existing = exists();
      if (existing !== null) {
        const earlier = seenAt.get(`${file.template.type}|${asciiNoCase(existing)}`);
        present.push({ ...at, message: earlier ? `Same as ${earlier}.` : `${existing} is already in the dataset.` });
        return;
      }
      try {
        write({});
      } catch (error) {
        if (!(error instanceof SensitiveInputWarning)) throw error;
        const values = error.findings.flatMap((f) => f.matches).join(", ");
        flagged.push({ ...at, message: `Looks like host data: ${values}` });
        if (!options.includeFlagged) return;
        write({ confirmSensitive: true });
      }
      count(file.template.type);
    } catch (error) {
      if (error instanceof Rejected || error instanceof ValidationError)
        rejected.push({ ...at, message: error.message });
      else throw error;
    }
  };
  /** Remember the row that first added a record, for "same as row N" messages. */
  const mark = (file: TemplateFile, row: TemplateRow, label: string) => {
    seenAt.set(`${file.template.type}|${asciiNoCase(label)}`, `row ${String(row.row)} of ${file.name}`);
  };

  const ordered = [...files].sort(
    (a, b) => IMPORT_ORDER.indexOf(a.template.type) - IMPORT_ORDER.indexOf(b.template.type),
  );
  repo.atomic(() => {
    const parents: { file: string; row: TemplateRow; id: number; parent: string; name: string }[] = [];
    for (const file of ordered) {
      for (const row of file.rows) {
        const v = row.values;
        const name = v["name"] ?? "";
        switch (file.template.type) {
          case "networks":
            apply(
              file,
              row,
              () => (existingNew(networks, name) ? `Network "${name}"` : null),
              (o) => {
                const kind = key((v["kind"] ?? "").trim());
                if (kind !== "internal" && kind !== "external") {
                  throw new Rejected(`Kind must be internal or external, not "${v["kind"] ?? ""}".`);
                }
                const n = repo.createNetwork(
                  { name, kind, marking: marking(v["marking"] ?? ""), description: v["description"] ?? null },
                  o,
                );
                networks.set(key(n.name), n.id);
                mark(file, row, `Network "${name}"`);
              },
            );
            break;
          case "organizations":
            // Created first, parents set after the whole file, so a parent may come later in it.
            apply(
              file,
              row,
              () => (existingNew(orgs, name) ? `Organization "${name}"` : null),
              (o) => {
                const org = repo.createOrganization({ name }, o);
                orgs.set(key(org.name), org.id);
                mark(file, row, `Organization "${name}"`);
                if ((v["parent"] ?? "").trim() !== "")
                  parents.push({ file: file.name, row, id: org.id, parent: v["parent"] ?? "", name: org.name });
              },
            );
            break;
          case "categories":
            apply(
              file,
              row,
              () => (existingNew(categories, name) ? `Category "${name}"` : null),
              (o) => {
                const c = repo.createCategory({ name, color: v["color"] ?? null }, o);
                categories.set(key(c.name), c.id);
                mark(file, row, `Category "${name}"`);
              },
            );
            break;
          case "applications":
            apply(
              file,
              row,
              () => (existingNew(applications, name) ? `Application "${name}"` : null),
              (o) => {
                const a = repo.createApplication(
                  { name, vendor: v["vendor"] ?? null, description: v["description"] ?? null },
                  o,
                );
                applications.set(key(a.name), a.id);
                mark(file, row, `Application "${name}"`);
              },
            );
            break;
          case "services": {
            const network = v["network"] ?? "";
            const label = `Service "${name}" on ${network}`;
            apply(
              file,
              row,
              () => {
                const networkId = lookup(networks, network);
                return networkId !== undefined && services.has(`${String(networkId)}|${key(name.trim())}`)
                  ? label
                  : null;
              },
              (o) => {
                const networkId = ref(networks, network, "network");
                const s = repo.createService(
                  {
                    name,
                    networkId,
                    marking: marking(v["marking"] ?? ""),
                    applicationId: optionalRef(applications, v["application"] ?? "", "application"),
                    categoryId: optionalRef(categories, v["category"] ?? "", "category"),
                    providerOrgId: optionalRef(orgs, v["provider"] ?? "", "organization"),
                    // Left blank, Identity and DNS are foundational, as in the editor (Q-021).
                    foundational: yesNo(v["foundational"] ?? "", "Foundational") ?? suggestsFoundational(name.trim()),
                    description: v["description"] ?? null,
                  },
                  o,
                );
                services.set(`${String(networkId)}|${key(s.name)}`, s.id);
                mark(file, row, label);
              },
            );
            break;
          }
          case "cds":
            apply(
              file,
              row,
              () => (existingNew(cds, name) ? `CDS "${name}"` : null),
              (o) => {
                const networkIds = (v["networks"] ?? "")
                  .split(";")
                  .filter((n) => n.trim() !== "")
                  .map((n) => ref(networks, n, "network"));
                const c = repo.createCds({ name, networkIds, description: v["description"] ?? null }, o);
                cds.set(key(c.name), c.id);
                mark(file, row, `CDS "${name}"`);
              },
            );
            break;
          case "support": {
            let label = "";
            apply(
              file,
              row,
              () => {
                const tier = Number((v["tier"] ?? "").replace(/^tier\s*/i, ""));
                if (tier !== 1 && tier !== 2 && tier !== 3) {
                  throw new Rejected(`Tier must be 1, 2 or 3, not "${v["tier"] ?? ""}".`);
                }
                const serviceId = service(v["service"] ?? "", v["network"] ?? "");
                const orgId = ref(orgs, v["organization"] ?? "", "organization");
                label = `Tier ${String(tier)} support for "${v["service"] ?? ""}" on ${v["network"] ?? ""}`;
                const current = support.get(`${String(serviceId)}|${String(tier)}`);
                if (current === orgId) return label;
                // Never overwrite an assignment the dataset already has.
                if (current !== undefined) throw new Rejected(`${label} is already set to another organization.`);
                return null;
              },
              (o) => {
                const tier = Number((v["tier"] ?? "").replace(/^tier\s*/i, "")) as Tier;
                const serviceId = service(v["service"] ?? "", v["network"] ?? "");
                const orgId = ref(orgs, v["organization"] ?? "", "organization");
                repo.setSupport(serviceId, tier, orgId, v["notes"] ?? null, o);
                support.set(`${String(serviceId)}|${String(tier)}`, orgId);
                mark(file, row, label);
              },
            );
            break;
          }
          case "consumers": {
            let pair = "";
            const label = `"${v["organization"] ?? ""}" consuming "${v["service"] ?? ""}" on ${v["network"] ?? ""}`;
            apply(
              file,
              row,
              () => {
                const orgId = ref(orgs, v["organization"] ?? "", "organization");
                const serviceId = service(v["service"] ?? "", v["network"] ?? "");
                pair = `${String(orgId)}|${String(serviceId)}`;
                return consumers.has(pair) ? label : null;
              },
              () => {
                const [orgId, serviceId] = pair.split("|").map(Number);
                repo.addConsumption(orgId ?? 0, serviceId ?? 0);
                consumers.add(pair);
                mark(file, row, label);
              },
            );
            break;
          }
          case "dependencies": {
            const label = `"${v["consumer"] ?? ""}" on ${v["consumer_network"] ?? ""} depending on "${v["provider"] ?? ""}" on ${v["provider_network"] ?? ""}`;
            let ids: [number, number] = [0, 0];
            apply(
              file,
              row,
              () => {
                ids = [
                  service(v["consumer"] ?? "", v["consumer_network"] ?? ""),
                  service(v["provider"] ?? "", v["provider_network"] ?? ""),
                ];
                return dependencies.has(ids.join("|")) ? label : null;
              },
              () => {
                repo.addDependency({
                  consumerServiceId: ids[0],
                  providerServiceId: ids[1],
                  viaCdsId: optionalRef(cds, v["via_cds"] ?? "", "CDS"),
                });
                dependencies.add(ids.join("|"));
                mark(file, row, label);
              },
            );
            break;
          }
        }
      }
    }
    for (const p of parents) {
      try {
        repo.updateOrganization(p.id, { name: p.name, parentId: ref(orgs, p.parent, "organization") });
      } catch (error) {
        if (!(error instanceof Rejected || error instanceof ValidationError)) throw error;
        rejected.push({
          file: p.file,
          row: p.row.row,
          message: `${error.message} The organization was added without a parent.`,
        });
      }
    }
  });
  return { added, present, rejected, flagged };
}

const NOUNS: Record<TemplateType, readonly [string, string]> = {
  networks: ["network", "networks"],
  organizations: ["organization", "organizations"],
  categories: ["category", "categories"],
  applications: ["application", "applications"],
  services: ["service", "services"],
  cds: ["cross-domain solution", "cross-domain solutions"],
  support: ["support tier", "support tiers"],
  consumers: ["consuming organization", "consuming organizations"],
  dependencies: ["dependency", "dependencies"],
};

/** "3 networks, 1 service", in import order, or "nothing" when no row was added. */
export function describeAdded(added: ImportReport["added"]): string {
  const parts = IMPORT_ORDER.flatMap((type) => {
    const n = added[type] ?? 0;
    return n > 0 ? [`${String(n)} ${NOUNS[type][n === 1 ? 0 : 1]}`] : [];
  });
  return parts.length > 0 ? parts.join(", ") : "nothing";
}
