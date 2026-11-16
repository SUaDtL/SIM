import type { Database, SqlValue } from "sql.js";
import { datasetName } from "../db/dataset";
import { highestMarking, isMarking, isValidCaveat, type Marking, normalizeCaveat } from "../db/markings";
import { applyScenario, serviceOrigin } from "../scenario/scenario";
import { SensitiveInputWarning, ValidationError, type DiagnosticTarget } from "./errors";
import type {
  Application,
  ApplicationInput,
  Category,
  CategoryInput,
  Cds,
  CdsInput,
  Consumption,
  Dependency,
  DependencyInput,
  History,
  Network,
  NetworkInput,
  NetworkKind,
  NodePosition,
  Organization,
  OrganizationInput,
  Scenario,
  ScenarioChange,
  ScenarioChangeInput,
  ScenarioInput,
  Service,
  ServiceInput,
  Snapshot,
  SupportAssignment,
  Tier,
  WriteOptions,
} from "./types";
import { checkSensitive, cleanName, cleanText } from "./validate";

type Row = Record<string, SqlValue>;
export interface RepositoryChange {
  readonly revision: number;
  readonly entity: string;
  readonly history?: History;
}
type Listener = (change: RepositoryChange) => void;

const POSITIONED = ["network", "service", "cds"] as const;
/** Matches the CHECK in migration 0002. */
const MAX_COORDINATE = 1e7;

const NAME_FIELD: Record<string, string> = {
  network: "network name",
  organization: "organization name",
  category: "category name",
  application: "application name",
  service: "service name",
  cds: "CDS name",
  scenario: "scenario name",
};

/** Undo history length; the oldest steps are dropped beyond it. */
export const MAX_UNDO_STEPS = 200;

/** A range of undo_log rows that one step replays. */
interface Step {
  readonly from: number;
  readonly to: number;
}

export interface ServiceEditBase {
  readonly service: Service;
  readonly support: readonly SupportAssignment[];
  readonly consumerOrgIds: readonly number[];
  readonly dependencies: readonly Dependency[];
}

export interface ServiceDraftInput {
  readonly fields: ServiceInput;
  readonly support: readonly { readonly tier: Tier; readonly orgId: number; readonly notes?: string | null }[];
  readonly consumerOrgIds: readonly number[];
  readonly dependencies: readonly { readonly providerServiceId: number; readonly viaCdsId?: number | null }[];
}

export type ServiceDraftResult =
  | { readonly status: "committed" | "unchanged"; readonly service: Service; readonly revision: number }
  | { readonly status: "conflict"; readonly message: string; readonly revision: number }
  | { readonly status: "refused"; readonly error: ValidationError; readonly revision: number }
  | { readonly status: "needs-confirmation"; readonly warning: SensitiveInputWarning; readonly revision: number };

export type DeleteEntityType = "network" | "service" | "organization" | "application" | "category" | "cds" | "scenario";
export interface DeletePlan {
  readonly details: readonly string[];
  readonly blocked: string | null;
  readonly signature: string;
  readonly blockers: readonly { readonly type: DeleteEntityType; readonly id: number; readonly label: string }[];
}
export interface ScenarioChangeRemovalPlan {
  readonly changes: readonly ScenarioChange[];
  readonly signature: string;
}
export interface ScenarioNameCollision {
  readonly key: string;
  readonly message: string;
  readonly networkId: number;
  readonly serviceIds: readonly [number, number];
}

/**
 * The only write path to a SIM dataset (coding standard CONV-002). Every write is validated,
 * runs in a transaction, and notifies subscribers only when it succeeds.
 *
 * Undo and redo (WORK-015) use SQLite's temp-trigger technique: temporary triggers on every table
 * log the SQL that reverses each change into a temporary table, and a step replays one write's
 * rows in reverse. Temporary objects never reach the saved file (export copies only "main").
 */
export class Repository {
  private readonly listeners = new Set<Listener>();
  private readonly projectionFailureListeners = new Set<(errors: readonly unknown[]) => void>();
  private readonly notificationQueue: RepositoryChange[] = [];
  private notifying = false;
  private revision = 0;
  private readonly undoSteps: Step[] = [];
  private readonly redoSteps: Step[] = [];
  /** Whether the latest undo step is the write that just finished, so a merge may extend it. */
  private mergeable = false;
  /** Inside group(): nesting depth, whether the group's step has started, and whether it wrote. */
  private grouping = 0;
  private groupStepStarted = false;
  private groupWrote = false;
  private atomicRunning = false;
  private savepointSerial = 0;

  constructor(private readonly db: Database) {
    this.installUndo();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Show the concrete reference effects of deleting the selected record. Map positions are irrelevant. */
  planDelete(type: DeleteEntityType, id: number): DeletePlan {
    const view = this.snapshot();
    const details: string[] = [];
    const effects: unknown[] = [type, id];
    const blockers: { type: DeleteEntityType; id: number; label: string }[] = [];
    let blocked: string | null = null;
    const add = (label: string, rows: readonly unknown[]): void => {
      if (rows.length === 0) return;
      details.push(`${String(rows.length)} ${label}`);
      effects.push([label, rows]);
    };
    const selected = {
      network: view.networks,
      service: view.services,
      organization: view.organizations,
      application: view.applications,
      category: view.categories,
      cds: view.cds,
      scenario: view.scenarios,
    }[type].find((item) => item.id === id);
    if (!selected) throw new ValidationError("NOT_FOUND", "delete", "The selected record no longer exists.");
    effects.push(selected.name);
    switch (type) {
      case "network": {
        const services = view.services.filter((item) => item.networkId === id).map((item) => [item.id, item.name]);
        const joins = view.cds.filter((item) => item.networkIds.includes(id)).map((item) => [item.id, item.name]);
        add("services using this network block deletion", services);
        add("CDS joins using this network block deletion", joins);
        add(
          "scenario changes removed with this network",
          view.scenarioChanges.filter((item) => "networkId" in item && item.networkId === id).map((item) => item.id),
        );
        if (services.length > 0 || joins.length > 0)
          blocked = "This network is still in use. Remove its services and CDS joins first.";
        blockers.push(
          ...view.services
            .filter((item) => item.networkId === id)
            .map((item) => ({ type: "service" as const, id: item.id, label: `Inspect blocking service ${item.name}` })),
          ...view.cds
            .filter((item) => item.networkIds.includes(id))
            .map((item) => ({ type: "cds" as const, id: item.id, label: `Inspect blocking CDS ${item.name}` })),
        );
        break;
      }
      case "service":
        add(
          "support assignments removed",
          view.support.filter((item) => item.serviceId === id).map((item) => [item.tier, item.orgId, item.notes]),
        );
        add(
          "consumer links removed",
          view.consumption.filter((item) => item.serviceId === id).map((item) => item.orgId),
        );
        add(
          "dependency links removed",
          view.dependencies
            .filter((item) => item.consumerServiceId === id || item.providerServiceId === id)
            .map((item) => [item.consumerServiceId, item.providerServiceId, item.viaCdsId]),
        );
        add(
          "scenario changes removed",
          view.scenarioChanges
            .filter(
              (item) =>
                ("serviceId" in item && item.serviceId === id) ||
                ("intoServiceId" in item && item.intoServiceId === id),
            )
            .map((item) => item.id),
        );
        break;
      case "organization":
        add(
          "child organizations detached",
          view.organizations.filter((item) => item.parentId === id).map((item) => item.id),
        );
        add(
          "service providers cleared",
          view.services.filter((item) => item.providerOrgId === id).map((item) => item.id),
        );
        add(
          "support assignments removed",
          view.support.filter((item) => item.orgId === id).map((item) => [item.serviceId, item.tier]),
        );
        add(
          "consumer links removed",
          view.consumption.filter((item) => item.orgId === id).map((item) => item.serviceId),
        );
        add(
          "scenario provider references cleared",
          view.scenarioChanges
            .filter((item) => "providerOrgId" in item && item.providerOrgId === id)
            .map((item) => item.id),
        );
        break;
      case "application":
        add(
          "service application references cleared",
          view.services.filter((item) => item.applicationId === id).map((item) => item.id),
        );
        break;
      case "category":
        add(
          "service category references cleared",
          view.services.filter((item) => item.categoryId === id).map((item) => item.id),
        );
        break;
      case "cds":
        add("network joins removed", view.cds.find((item) => item.id === id)?.networkIds ?? []);
        add(
          "dependency CDS references cleared; connectivity becomes unverified",
          view.dependencies
            .filter((item) => item.viaCdsId === id)
            .map((item) => [item.consumerServiceId, item.providerServiceId]),
        );
        break;
      case "scenario":
        add(
          "scenario changes removed",
          view.scenarioChanges.filter((item) => item.scenarioId === id).map((item) => item.id),
        );
        break;
    }
    if (details.length === 0) details.push("No related records will change.");
    return { details, blocked, blockers, signature: JSON.stringify(effects) };
  }

  /** Recheck the consequence plan immediately before a confirmed delete. */
  deleteWithPlan(type: DeleteEntityType, id: number, signature: string): void {
    const current = this.planDelete(type, id);
    if (current.signature !== signature) {
      throw new ValidationError(
        "STALE",
        "delete",
        "The deletion consequences changed. Review them again before confirming.",
      );
    }
    if (current.blocked) throw new ValidationError("IN_USE", "delete", current.blocked);
    switch (type) {
      case "network":
        this.deleteNetwork(id);
        break;
      case "service":
        this.deleteService(id);
        break;
      case "organization":
        this.deleteOrganization(id);
        break;
      case "application":
        this.deleteApplication(id);
        break;
      case "category":
        this.deleteCategory(id);
        break;
      case "cds":
        this.deleteCds(id);
        break;
      case "scenario":
        this.deleteScenario(id);
        break;
    }
  }

  /** Report presentation failures after a committed write without changing its outcome. */
  subscribeProjectionFailures(listener: (errors: readonly unknown[]) => void): () => void {
    this.projectionFailureListeners.add(listener);
    return () => this.projectionFailureListeners.delete(listener);
  }

  currentRevision(): number {
    return this.revision;
  }

  private notify(entity: string, history: History = "own"): void {
    this.notificationQueue.push({ revision: ++this.revision, entity, history });
    if (this.notifying) return;
    this.notifying = true;
    try {
      for (const change of this.notificationQueue) {
        const errors: unknown[] = [];
        for (const listener of this.listeners) {
          try {
            listener(change);
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length > 0) {
          for (const listener of this.projectionFailureListeners) {
            try {
              listener(errors);
            } catch {
              // Reporting failures cannot change the committed data outcome.
            }
          }
        }
      }
    } finally {
      this.notificationQueue.length = 0;
      this.notifying = false;
    }
  }

  // ---- networks ----

  listNetworks(): Network[] {
    return this.rows("SELECT * FROM network ORDER BY name").map(toNetwork);
  }

  getNetwork(id: number): Network | undefined {
    const row = this.row("SELECT * FROM network WHERE id = ?", [id]);
    return row && toNetwork(row);
  }

  createNetwork(input: NetworkInput, options: WriteOptions = {}): Network {
    const v = this.network(input, options);
    return this.write(() => {
      const id = this.insert("INSERT INTO network (name, kind, marking, description) VALUES (?, ?, ?, ?)", v);
      return this.mustGet(this.getNetwork(id));
    }, "network");
  }

  updateNetwork(id: number, input: NetworkInput, options: WriteOptions = {}): Network {
    const v = this.network(input, options, this.getNetwork(id));
    return this.write(() => {
      this.update(
        "UPDATE network SET name = ?, kind = ?, marking = ?, description = ? WHERE id = ?",
        [...v, id],
        "network",
      );
      return this.mustGet(this.getNetwork(id));
    }, "network");
  }

  deleteNetwork(id: number): void {
    // cds_network cascades on delete, which would silently shrink a CDS; refuse instead.
    const joined = this.row(
      "SELECT c.name FROM cds_network cn JOIN cds c ON c.id = cn.cds_id WHERE cn.network_id = ? ORDER BY c.name",
      [id],
    );
    if (joined) {
      throw new ValidationError(
        "IN_USE",
        "network",
        `That network is still in use: the CDS ${String(joined["name"])} joins it; remove it from the CDS first.`,
      );
    }
    this.write(() => {
      this.update("DELETE FROM network WHERE id = ?", [id], "network");
    }, "network");
  }

  private network(input: NetworkInput, options: WriteOptions, current?: Network): SqlValue[] {
    const name = unchangedName(input.name, current?.name, NAME_FIELD["network"] ?? "name");
    const kind = requireKind(input.kind);
    const marking = requireMarking(input.marking);
    const description = unchangedText(input.description, current?.description);
    checkSensitive(
      {
        "network name": name === current?.name ? null : name,
        description: description === current?.description ? null : description,
      },
      options.confirmSensitive === true,
    );
    return [name, kind, marking, description];
  }

  // ---- organizations ----

  listOrganizations(): Organization[] {
    return this.rows("SELECT * FROM organization ORDER BY name").map(toOrganization);
  }

  getOrganization(id: number): Organization | undefined {
    const row = this.row("SELECT * FROM organization WHERE id = ?", [id]);
    return row && toOrganization(row);
  }

  createOrganization(input: OrganizationInput, options: WriteOptions = {}): Organization {
    const v = this.organization(null, input, options);
    return this.write(() => {
      const id = this.insert("INSERT INTO organization (name, parent_id) VALUES (?, ?)", v);
      return this.mustGet(this.getOrganization(id));
    }, "organization");
  }

  updateOrganization(id: number, input: OrganizationInput, options: WriteOptions = {}): Organization {
    const v = this.organization(id, input, options);
    return this.write(() => {
      this.update("UPDATE organization SET name = ?, parent_id = ? WHERE id = ?", [...v, id], "organization");
      return this.mustGet(this.getOrganization(id));
    }, "organization");
  }

  deleteOrganization(id: number): void {
    this.write(() => {
      this.update("DELETE FROM organization WHERE id = ?", [id], "organization");
    }, "organization");
  }

  private organization(id: number | null, input: OrganizationInput, options: WriteOptions): SqlValue[] {
    const current = id === null ? undefined : this.getOrganization(id);
    const name = unchangedName(input.name, current?.name, NAME_FIELD["organization"] ?? "name");
    const parentId = input.parentId ?? null;
    if (parentId !== null && parentId !== current?.parentId) {
      this.requireExists("organization", parentId, "parent");
      // Walk up from the proposed parent; reaching this organization would close a loop.
      const visited = new Set<number>();
      for (let at: number | null = parentId; at !== null; at = this.getOrganization(at)?.parentId ?? null) {
        if (at === id) throw new ValidationError("CYCLE", "parent", "An organization cannot be nested under itself.");
        if (visited.has(at)) {
          throw new ValidationError(
            "CYCLE",
            "parent",
            "The selected parent already belongs to a cycle; repair it first.",
          );
        }
        visited.add(at);
      }
    }
    checkSensitive({ "organization name": name === current?.name ? null : name }, options.confirmSensitive === true);
    return [name, parentId];
  }

  // ---- categories ----

  listCategories(): Category[] {
    return this.rows("SELECT * FROM category ORDER BY name").map(toCategory);
  }

  getCategory(id: number): Category | undefined {
    const row = this.row("SELECT * FROM category WHERE id = ?", [id]);
    return row && toCategory(row);
  }

  createCategory(input: CategoryInput, options: WriteOptions = {}): Category {
    const v = this.category(input, options);
    return this.write(() => {
      const id = this.insert("INSERT INTO category (name, color) VALUES (?, ?)", v);
      return this.mustGet(this.getCategory(id));
    }, "category");
  }

  updateCategory(id: number, input: CategoryInput, options: WriteOptions = {}): Category {
    const v = this.category(input, options, this.getCategory(id));
    return this.write(() => {
      this.update("UPDATE category SET name = ?, color = ? WHERE id = ?", [...v, id], "category");
      return this.mustGet(this.getCategory(id));
    }, "category");
  }

  deleteCategory(id: number): void {
    this.write(() => {
      this.update("DELETE FROM category WHERE id = ?", [id], "category");
    }, "category");
  }

  private category(input: CategoryInput, options: WriteOptions, current?: Category): SqlValue[] {
    const name = unchangedName(input.name, current?.name, NAME_FIELD["category"] ?? "name");
    const color = unchangedText(input.color, current?.color);
    if (color !== current?.color && color !== null && !/^#[0-9a-f]{6}$/i.test(color)) {
      throw new ValidationError("INVALID_VALUE", "color", "A color must look like #1a2b3c.");
    }
    checkSensitive({ "category name": name === current?.name ? null : name }, options.confirmSensitive === true);
    return [name, color];
  }

  // ---- applications ----

  listApplications(): Application[] {
    return this.rows("SELECT * FROM application ORDER BY name").map(toApplication);
  }

  getApplication(id: number): Application | undefined {
    const row = this.row("SELECT * FROM application WHERE id = ?", [id]);
    return row && toApplication(row);
  }

  createApplication(input: ApplicationInput, options: WriteOptions = {}): Application {
    const v = this.application(input, options);
    return this.write(() => {
      const id = this.insert("INSERT INTO application (name, vendor, description) VALUES (?, ?, ?)", v);
      return this.mustGet(this.getApplication(id));
    }, "application");
  }

  updateApplication(id: number, input: ApplicationInput, options: WriteOptions = {}): Application {
    const v = this.application(input, options, this.getApplication(id));
    return this.write(() => {
      this.update(
        "UPDATE application SET name = ?, vendor = ?, description = ? WHERE id = ?",
        [...v, id],
        "application",
      );
      return this.mustGet(this.getApplication(id));
    }, "application");
  }

  deleteApplication(id: number): void {
    this.write(() => {
      this.update("DELETE FROM application WHERE id = ?", [id], "application");
    }, "application");
  }

  private application(input: ApplicationInput, options: WriteOptions, current?: Application): SqlValue[] {
    const name = unchangedName(input.name, current?.name, NAME_FIELD["application"] ?? "name");
    const vendor = unchangedText(input.vendor, current?.vendor);
    const description = unchangedText(input.description, current?.description);
    checkSensitive(
      {
        "application name": name === current?.name ? null : name,
        vendor: vendor === current?.vendor ? null : vendor,
        description: description === current?.description ? null : description,
      },
      options.confirmSensitive === true,
    );
    return [name, vendor, description];
  }

  // ---- services ----

  listServices(): Service[] {
    return this.rows("SELECT * FROM service ORDER BY network_id, name").map(toService);
  }

  getService(id: number): Service | undefined {
    const row = this.row("SELECT * FROM service WHERE id = ?", [id]);
    return row && toService(row);
  }

  /** The relevant edit base excludes map position and unrelated records. */
  readServiceEditBase(id: number): ServiceEditBase {
    const service = this.getService(id);
    if (!service) throw new ValidationError("NOT_FOUND", "service", "The selected service no longer exists.");
    return {
      service,
      support: this.listSupport(id),
      consumerOrgIds: this.listConsumption()
        .filter((row) => row.serviceId === id)
        .map((row) => row.orgId)
        .sort((a, b) => a - b),
      dependencies: this.listDependencies().filter((row) => row.consumerServiceId === id),
    };
  }

  /** Commit an existing service's visible fields and owned relationships as one command. */
  applyServiceDraft(
    id: number,
    expected: ServiceEditBase,
    draft: ServiceDraftInput,
    options: WriteOptions = {},
  ): ServiceDraftResult {
    const revision = this.currentRevision();
    const current = this.readServiceEditBase(id);
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      return {
        status: "conflict",
        message: "This service or one of its relationships changed. Review the current record before applying.",
        revision,
      };
    }
    try {
      const merged: ServiceInput = {
        name: draft.fields.name,
        networkId: draft.fields.networkId,
        marking: draft.fields.marking,
        applicationId:
          draft.fields.applicationId === undefined ? current.service.applicationId : draft.fields.applicationId,
        categoryId: draft.fields.categoryId === undefined ? current.service.categoryId : draft.fields.categoryId,
        providerOrgId:
          draft.fields.providerOrgId === undefined ? current.service.providerOrgId : draft.fields.providerOrgId,
        foundational:
          draft.fields.foundational === undefined ? current.service.foundational : draft.fields.foundational,
        description: draft.fields.description === undefined ? current.service.description : draft.fields.description,
      };
      // A readable legacy record may contain text that current create rules reject.
      // The shared update validator preserves exact unchanged legacy values.
      const values = this.service(merged, { confirmSensitive: true }, current.service);
      this.checkServiceDraftSensitive({ ...draft, fields: merged }, options, current);
      const support = draft.support.map((row) => {
        requireTier(row.tier);
        this.requireExists("organization", row.orgId, "organization");
        const prior = current.support.find((old) => old.tier === row.tier);
        const notes =
          prior?.orgId === row.orgId && (row.notes === undefined || row.notes === prior.notes)
            ? prior.notes
            : cleanText(row.notes);
        return { serviceId: id, tier: row.tier, orgId: row.orgId, notes };
      });
      if (new Set(support.map((row) => row.tier)).size !== support.length) {
        throw new ValidationError("DUPLICATE", "support", "Each support tier can be assigned once.");
      }
      support.sort((a, b) => a.tier - b.tier);
      const consumerOrgIds = [...new Set(draft.consumerOrgIds)].sort((a, b) => a - b);
      for (const orgId of consumerOrgIds) this.requireExists("organization", orgId, "consumer");
      const dependencies = draft.dependencies.map((row) => {
        if (row.providerServiceId === id)
          throw new ValidationError("SELF_LINK", "dependency", "A service cannot depend on itself.");
        this.requireExists("service", row.providerServiceId, "provider");
        const viaCdsId = row.viaCdsId ?? null;
        if (viaCdsId !== null) this.requireExists("cds", viaCdsId, "via");
        return { consumerServiceId: id, providerServiceId: row.providerServiceId, viaCdsId };
      });
      if (new Set(dependencies.map((row) => row.providerServiceId)).size !== dependencies.length) {
        throw new ValidationError("DUPLICATE", "dependency", "A service can depend on each provider only once.");
      }
      dependencies.sort((a, b) => a.providerServiceId - b.providerServiceId);
      const nextService: Service = {
        id,
        name: String(values[0]),
        networkId: Number(values[1]),
        applicationId: values[2] === null ? null : Number(values[2]),
        categoryId: values[3] === null ? null : Number(values[3]),
        providerOrgId: values[4] === null ? null : Number(values[4]),
        marking: merged.marking,
        foundational: values[6] === 1,
        description: values[7] === null ? null : String(values[7]),
      };
      const next = { service: nextService, support, consumerOrgIds, dependencies };
      if (JSON.stringify(next) === JSON.stringify(current))
        return { status: "unchanged", service: current.service, revision };

      const brokenBefore = this.brokenRoutes();
      const service = this.atomic(() => {
        this.update(
          `UPDATE service SET name = ?, network_id = ?, application_id = ?, category_id = ?, provider_org_id = ?,
           marking = ?, foundational = ?, description = ?,
           map_x = CASE WHEN network_id = ? THEN map_x END, map_y = CASE WHEN network_id = ? THEN map_y END
           WHERE id = ?`,
          [...values, merged.networkId, merged.networkId, id],
          "service",
        );
        this.db.run("DELETE FROM support_assignment WHERE service_id = ?", [id]);
        for (const row of support) {
          this.db.run("INSERT INTO support_assignment (service_id, tier, org_id, notes) VALUES (?, ?, ?, ?)", [
            id,
            row.tier,
            row.orgId,
            row.notes,
          ]);
        }
        this.db.run("DELETE FROM org_consumes WHERE service_id = ?", [id]);
        for (const orgId of consumerOrgIds)
          this.db.run("INSERT INTO org_consumes (org_id, service_id) VALUES (?, ?)", [orgId, id]);
        this.db.run("DELETE FROM service_dependency WHERE consumer_service_id = ?", [id]);
        for (const row of dependencies) {
          this.db.run(
            "INSERT INTO service_dependency (consumer_service_id, provider_service_id, via_cds_id) VALUES (?, ?, ?)",
            [id, row.providerServiceId, row.viaCdsId],
          );
        }
        this.requireNoNewInvalidRoutes(brokenBefore, "network");
        return this.mustGet(this.getService(id));
      });
      return { status: "committed", service, revision: this.currentRevision() };
    } catch (error) {
      if (error instanceof SensitiveInputWarning) return { status: "needs-confirmation", warning: error, revision };
      const translated = translate(error, "service");
      if (translated instanceof ValidationError) return { status: "refused", error: translated, revision };
      throw translated;
    }
  }

  createService(input: ServiceInput, options: WriteOptions = {}): Service {
    const v = this.service(input, options);
    return this.write(() => {
      const id = this.insert(
        `INSERT INTO service (name, network_id, application_id, category_id, provider_org_id, marking, foundational, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        v,
      );
      return this.mustGet(this.getService(id));
    }, "service");
  }

  /** The initial service and all its owned relationships share one transaction and history step. */
  createServiceDraft(draft: ServiceDraftInput, options: WriteOptions = {}): ServiceDraftResult {
    const revision = this.currentRevision();
    const rejected: { result: ServiceDraftResult | null } = { result: null };
    try {
      this.checkServiceDraftSensitive(draft, options);
      const service = this.atomic(() => {
        const created = this.createService(draft.fields, options);
        const result = this.applyServiceDraft(created.id, this.readServiceEditBase(created.id), draft, options);
        if (result.status !== "committed" && result.status !== "unchanged") {
          rejected.result = result;
          throw new Error("Initial service aggregate refused");
        }
        return result.service;
      });
      return { status: "committed", service, revision: this.currentRevision() };
    } catch (error) {
      if (rejected.result) return { ...rejected.result, revision };
      if (error instanceof SensitiveInputWarning) return { status: "needs-confirmation", warning: error, revision };
      const translated = translate(error, "service");
      if (translated instanceof ValidationError) return { status: "refused", error: translated, revision };
      throw translated;
    }
  }

  /** One warning covers the normalized command, including every changed support note. */
  private checkServiceDraftSensitive(draft: ServiceDraftInput, options: WriteOptions, current?: ServiceEditBase): void {
    const values = this.service(draft.fields, { confirmSensitive: true }, current?.service);
    const fields: Record<string, string | null> = {
      "service name": values[0] === current?.service.name ? null : String(values[0]),
      description: values[7] === current?.service.description || values[7] === null ? null : String(values[7]),
    };
    const seen = new Set<Tier>();
    for (const row of draft.support) {
      requireTier(row.tier);
      this.requireExists("organization", row.orgId, "organization");
      if (seen.has(row.tier))
        throw new ValidationError("DUPLICATE", "support", "Each support tier can be assigned once.");
      seen.add(row.tier);
      const prior = current?.support.find((old) => old.tier === row.tier);
      const notes =
        prior?.orgId === row.orgId && (row.notes === undefined || row.notes === prior.notes)
          ? prior.notes
          : cleanText(row.notes);
      fields[`Tier ${String(row.tier)} support notes`] =
        prior?.orgId === row.orgId && notes === prior.notes ? null : notes;
    }
    checkSensitive(fields, options.confirmSensitive === true);
  }

  updateService(id: number, input: ServiceInput, options: WriteOptions = {}): Service {
    const v = this.service(input, options, this.getService(id));
    const brokenBefore = this.brokenRoutes();
    return this.write(() => {
      this.update(
        `UPDATE service SET name = ?, network_id = ?, application_id = ?, category_id = ?, provider_org_id = ?,
         marking = ?, foundational = ?, description = ?,
         map_x = CASE WHEN network_id = ? THEN map_x END, map_y = CASE WHEN network_id = ? THEN map_y END
         WHERE id = ?`,
        // A position belongs to the network it was placed in; a moved service is placed afresh.
        [...v, input.networkId, input.networkId, id],
        "service",
      );
      this.requireNoNewInvalidRoutes(brokenBefore, "network");
      return this.mustGet(this.getService(id));
    }, "service");
  }

  deleteService(id: number): void {
    this.write(() => {
      this.update("DELETE FROM service WHERE id = ?", [id], "service");
    }, "service");
  }

  private service(input: ServiceInput, options: WriteOptions, current?: Service): SqlValue[] {
    const name = unchangedName(input.name, current?.name, NAME_FIELD["service"] ?? "name");
    this.requireExists("network", input.networkId, "network");
    const applicationId = this.optionalRef("application", input.applicationId, "application");
    const categoryId = this.optionalRef("category", input.categoryId, "category");
    const providerOrgId = this.optionalRef("organization", input.providerOrgId, "provider");
    const marking = requireMarking(input.marking);
    const description = unchangedText(input.description, current?.description);
    checkSensitive(
      {
        "service name": name === current?.name ? null : name,
        description: description === current?.description ? null : description,
      },
      options.confirmSensitive === true,
    );
    return [
      name,
      input.networkId,
      applicationId,
      categoryId,
      providerOrgId,
      marking,
      input.foundational ? 1 : 0,
      description,
    ];
  }

  // ---- CDS ----

  listCds(): Cds[] {
    return this.rows("SELECT * FROM cds ORDER BY name").map((r) => this.toCds(r));
  }

  getCds(id: number): Cds | undefined {
    const row = this.row("SELECT * FROM cds WHERE id = ?", [id]);
    return row && this.toCds(row);
  }

  createCds(input: CdsInput, options: WriteOptions = {}): Cds {
    const { name, description, networkIds } = this.cds(input, options);
    return this.write(() => {
      const id = this.insert("INSERT INTO cds (name, description) VALUES (?, ?)", [name, description]);
      this.setCdsNetworks(id, networkIds);
      return this.mustGet(this.getCds(id));
    }, "cds");
  }

  updateCds(id: number, input: CdsInput, options: WriteOptions = {}): Cds {
    const current = this.getCds(id);
    const { name, description, networkIds } = this.cds(input, options, current);
    const brokenBefore = this.brokenRoutes();
    return this.write(() => {
      this.update("UPDATE cds SET name = ?, description = ? WHERE id = ?", [name, description, id], "CDS");
      if (!current || !sameIds(networkIds, current.networkIds)) this.setCdsNetworks(id, networkIds);
      this.requireNoNewInvalidRoutes(brokenBefore, "networks");
      return this.mustGet(this.getCds(id));
    }, "cds");
  }

  deleteCds(id: number): void {
    this.write(() => {
      this.update("DELETE FROM cds WHERE id = ?", [id], "CDS");
    }, "cds");
  }

  private cds(input: CdsInput, options: WriteOptions, current?: Cds) {
    const name = unchangedName(input.name, current?.name, NAME_FIELD["cds"] ?? "name");
    const networkIds = [...new Set(input.networkIds)].sort((a, b) => a - b);
    if (networkIds.length < 2 && (!current || !sameIds(networkIds, current.networkIds))) {
      throw new ValidationError("CDS_NETWORKS", "networks", "A CDS must join at least two networks.");
    }
    for (const n of networkIds) this.requireExists("network", n, "networks");
    const description = unchangedText(input.description, current?.description);
    checkSensitive(
      {
        "CDS name": name === current?.name ? null : name,
        description: description === current?.description ? null : description,
      },
      options.confirmSensitive === true,
    );
    return { name, description, networkIds };
  }

  private setCdsNetworks(id: number, networkIds: readonly number[]): void {
    this.db.run("DELETE FROM cds_network WHERE cds_id = ?", [id]);
    for (const n of networkIds) this.db.run("INSERT INTO cds_network (cds_id, network_id) VALUES (?, ?)", [id, n]);
  }

  private toCds(row: Row): Cds {
    const id = Number(row["id"]);
    const networkIds = this.rows("SELECT network_id FROM cds_network WHERE cds_id = ? ORDER BY network_id", [id]).map(
      (r) => Number(r["network_id"]),
    );
    return { id, name: String(row["name"]), description: text(row["description"]), networkIds };
  }

  // ---- support ----

  listSupport(serviceId?: number): SupportAssignment[] {
    const rows =
      serviceId === undefined
        ? this.rows("SELECT * FROM support_assignment ORDER BY service_id, tier")
        : this.rows("SELECT * FROM support_assignment WHERE service_id = ? ORDER BY tier", [serviceId]);
    return rows.map((r) => ({
      serviceId: Number(r["service_id"]),
      tier: Number(r["tier"]) as Tier,
      orgId: Number(r["org_id"]),
      notes: text(r["notes"]),
    }));
  }

  /** Assign (or with `orgId` null, clear) the organization supporting a service at a tier. */
  setSupport(
    serviceId: number,
    tier: Tier,
    orgId: number | null,
    notes?: string | null,
    options: WriteOptions = {},
  ): void {
    requireTier(tier);
    this.requireExists("service", serviceId, "service");
    if (orgId !== null) this.requireExists("organization", orgId, "organization");
    const cleanNotes = cleanText(notes);
    checkSensitive({ notes: cleanNotes }, options.confirmSensitive === true);
    this.write(() => {
      this.db.run("DELETE FROM support_assignment WHERE service_id = ? AND tier = ?", [serviceId, tier]);
      if (orgId !== null) {
        this.db.run("INSERT INTO support_assignment (service_id, tier, org_id, notes) VALUES (?, ?, ?, ?)", [
          serviceId,
          tier,
          orgId,
          cleanNotes,
        ]);
      }
    }, "support");
  }

  // ---- consumption and dependencies ----

  listConsumption(): Consumption[] {
    return this.rows("SELECT * FROM org_consumes ORDER BY org_id, service_id").map((r) => ({
      orgId: Number(r["org_id"]),
      serviceId: Number(r["service_id"]),
    }));
  }

  addConsumption(orgId: number, serviceId: number): void {
    this.requireExists("organization", orgId, "organization");
    this.requireExists("service", serviceId, "service");
    this.write(() => {
      this.db.run("INSERT INTO org_consumes (org_id, service_id) VALUES (?, ?)", [orgId, serviceId]);
    }, "consumption");
  }

  removeConsumption(orgId: number, serviceId: number): void {
    this.write(() => {
      this.db.run("DELETE FROM org_consumes WHERE org_id = ? AND service_id = ?", [orgId, serviceId]);
    }, "consumption");
  }

  listDependencies(): Dependency[] {
    return this.rows("SELECT * FROM service_dependency ORDER BY consumer_service_id, provider_service_id").map((r) => ({
      consumerServiceId: Number(r["consumer_service_id"]),
      providerServiceId: Number(r["provider_service_id"]),
      viaCdsId: r["via_cds_id"] === null ? null : Number(r["via_cds_id"]),
    }));
  }

  addDependency(input: DependencyInput): void {
    const consumer = this.getService(input.consumerServiceId);
    const provider = this.getService(input.providerServiceId);
    if (!consumer) throw new ValidationError("NOT_FOUND", "consumer", "The consuming service no longer exists.");
    if (!provider) throw new ValidationError("NOT_FOUND", "provider", "The providing service no longer exists.");
    if (consumer.id === provider.id) {
      throw new ValidationError("SELF_LINK", "provider", "A service cannot depend on itself.");
    }
    const via = input.viaCdsId ?? null;
    if (via !== null) {
      const cds = this.getCds(via);
      if (!cds) throw new ValidationError("NOT_FOUND", "via", "That CDS no longer exists.");
      if (consumer.networkId === provider.networkId) {
        throw new ValidationError(
          "CDS_ROUTE",
          "via",
          "A CDS route must connect services on two different networks.",
          this.routeDiagnosticTargets(consumer.id, provider.id, cds.id),
        );
      }
      if (!cds.networkIds.includes(consumer.networkId) || !cds.networkIds.includes(provider.networkId)) {
        throw new ValidationError(
          "CDS_ROUTE",
          "via",
          `${cds.name} does not join both of these networks.`,
          this.routeDiagnosticTargets(consumer.id, provider.id, cds.id),
        );
      }
    }
    this.write(() => {
      this.db.run(
        "INSERT INTO service_dependency (consumer_service_id, provider_service_id, via_cds_id) VALUES (?, ?, ?)",
        [consumer.id, provider.id, via],
      );
    }, "dependency");
  }

  removeDependency(consumerServiceId: number, providerServiceId: number): void {
    this.write(() => {
      this.db.run("DELETE FROM service_dependency WHERE consumer_service_id = ? AND provider_service_id = ?", [
        consumerServiceId,
        providerServiceId,
      ]);
    }, "dependency");
  }

  // ---- scenarios (WORK-013) ----

  listScenarios(): Scenario[] {
    return this.rows("SELECT * FROM scenario ORDER BY name").map(toScenario);
  }

  getScenario(id: number): Scenario | undefined {
    const row = this.row("SELECT * FROM scenario WHERE id = ?", [id]);
    return row && toScenario(row);
  }

  createScenario(input: ScenarioInput, options: WriteOptions = {}): Scenario {
    const v = this.scenario(input, options);
    return this.write(() => {
      const id = this.insert("INSERT INTO scenario (name, description) VALUES (?, ?)", v);
      return this.mustGet(this.getScenario(id));
    }, "scenario");
  }

  updateScenario(id: number, input: ScenarioInput, options: WriteOptions = {}): Scenario {
    const v = this.scenario(input, options, this.getScenario(id));
    return this.write(() => {
      this.update("UPDATE scenario SET name = ?, description = ? WHERE id = ?", [...v, id], "scenario");
      return this.mustGet(this.getScenario(id));
    }, "scenario");
  }

  deleteScenario(id: number): void {
    this.write(() => {
      this.update("DELETE FROM scenario WHERE id = ?", [id], "scenario");
    }, "scenario");
  }

  private scenario(input: ScenarioInput, options: WriteOptions, current?: Scenario): SqlValue[] {
    const name = unchangedName(input.name, current?.name, NAME_FIELD["scenario"] ?? "name");
    const description = unchangedText(input.description, current?.description);
    checkSensitive(
      {
        "scenario name": name === current?.name ? null : name,
        description: description === current?.description ? null : description,
      },
      options.confirmSensitive === true,
    );
    return [name, description];
  }

  listScenarioChanges(scenarioId?: number): ScenarioChange[] {
    const where = scenarioId === undefined ? "" : "WHERE scenario_id = ?";
    const params = scenarioId === undefined ? [] : [scenarioId];
    return this.rows(`SELECT * FROM scenario_change ${where} ORDER BY scenario_id, id`, params).map(toScenarioChange);
  }

  /** Final projected duplicate names, including pre-existing issues caused by later As-Is edits. */
  scenarioNameCollisions(scenarioId: number): ScenarioNameCollision[] {
    const projection = applyScenario(this.snapshot(), scenarioId);
    const buckets = new Map<string, Service[]>();
    for (const service of projection.services) {
      // SQLite NOCASE folds ASCII A-Z only; Unicode case distinctions remain intact.
      const folded = service.name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
      const key = JSON.stringify([service.networkId, folded]);
      const bucket = buckets.get(key) ?? [];
      bucket.push(service);
      buckets.set(key, bucket);
    }
    const collisions: ScenarioNameCollision[] = [];
    for (const bucket of buckets.values()) {
      for (let left = 0; left < bucket.length; left++) {
        for (let right = left + 1; right < bucket.length; right++) {
          const a = bucket[left];
          const b = bucket[right];
          if (!a || !b) continue;
          const origins = [serviceOrigin(projection, a.id), serviceOrigin(projection, b.id)]
            .map((origin) => JSON.stringify(origin))
            .sort();
          collisions.push({
            key: JSON.stringify([scenarioId, a.networkId, origins]),
            message: `${a.name} conflicts with ${b.name} on the same projected network.`,
            networkId: a.networkId,
            serviceIds: [a.id, b.id],
          });
        }
      }
    }
    return collisions;
  }

  /**
   * Add one change to a scenario. The As-Is records are never touched: a change only says what the
   * scenario does to them, so later As-Is edits carry into every scenario.
   */
  addScenarioChange(scenarioId: number, input: ScenarioChangeInput, options: WriteOptions = {}): ScenarioChange {
    this.requireExists("scenario", scenarioId, "scenario");
    const values = this.scenarioChange(input, this.listScenarioChanges(scenarioId), options);
    const before = new Set(this.scenarioNameCollisions(scenarioId).map((issue) => issue.key));
    return this.atomic(() => {
      const id = this.insert(
        `INSERT INTO scenario_change (scenario_id, kind, service_id, into_service_id, into_change_id, network_id,
         provider_org_id, name, marking, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [scenarioId, input.kind, ...values],
      );
      const newIssue = this.scenarioNameCollisions(scenarioId).find((issue) => !before.has(issue.key));
      if (newIssue) {
        throw new ValidationError(
          "DUPLICATE",
          input.kind === "add" ? "service name" : "network",
          input.kind === "add" ? "That service already exists on that network." : newIssue.message,
        );
      }
      return this.mustGet(this.listScenarioChanges(scenarioId).find((c) => c.id === id));
    });
  }

  /** Mirror the scenario-local foreign-key cascade without writing or depending on unrelated drafts. */
  planRemoveScenarioChange(id: number): ScenarioChangeRemovalPlan {
    const selected = this.listScenarioChanges().find((change) => change.id === id);
    if (!selected) throw new ValidationError("NOT_FOUND", "scenario change", "The proposed change no longer exists.");
    const all = this.listScenarioChanges(selected.scenarioId);
    const removed = new Set([id]);
    // Follow the actual FK, including safely admitted legacy chains, rather than assuming every target is an add.
    let previousSize = 0;
    while (removed.size !== previousSize) {
      previousSize = removed.size;
      for (const change of all) {
        if (change.kind === "merge" && change.intoChangeId !== null && removed.has(change.intoChangeId)) {
          removed.add(change.id);
        }
      }
    }
    const changes = all.filter((change) => removed.has(change.id));
    return { changes, signature: JSON.stringify(changes) };
  }

  /** Remove one change and its dependent merges as one Undo step; recheck a reviewed consequence set. */
  removeScenarioChange(id: number, signature?: string): void {
    if (signature !== undefined && this.planRemoveScenarioChange(id).signature !== signature) {
      throw new ValidationError(
        "STALE",
        "scenario change",
        "The removal consequences changed. Review the proposed changes again before confirming.",
      );
    }
    this.write(() => {
      this.update("DELETE FROM scenario_change WHERE id = ?", [id], "scenario change");
    }, "scenario change");
  }

  /** Check a change against the scenario's others; returns its columns after scenario_id and kind. */
  private scenarioChange(
    input: ScenarioChangeInput,
    changes: readonly ScenarioChange[],
    options: WriteOptions,
  ): SqlValue[] {
    if (input.kind === "add") {
      const name = cleanName(input.name, "service name");
      this.requireExists("network", input.networkId, "network");
      const providerOrgId = this.optionalRef("organization", input.providerOrgId, "provider");
      const marking = requireMarking(input.marking);
      const description = cleanText(input.description);
      checkSensitive({ "service name": name, description }, options.confirmSensitive === true);
      return [null, null, null, input.networkId, providerOrgId, name, marking, description];
    }

    const service = this.getService(input.serviceId);
    if (!service) throw new ValidationError("NOT_FOUND", "service", "The selected service does not exist.");
    if (changes.some((c) => c.kind !== "add" && c.serviceId === service.id)) {
      throw new ValidationError("DUPLICATE", "service", `${service.name} already has a change in this scenario.`);
    }
    // A service others merge into must stay; merging it away too would leave them nowhere to go.
    const target = changes.some((c) => c.kind === "merge" && c.intoServiceId === service.id);
    if (target && input.kind !== "rehome") {
      throw new ValidationError(
        "IN_USE",
        "service",
        `Other services merge into ${service.name} in this scenario; change those merges first.`,
      );
    }
    if (input.kind === "retire") return [service.id, null, null, null, null, null, null, null];

    if (input.kind === "merge") {
      const intoServiceId = input.intoServiceId ?? null;
      const intoChangeId = input.intoChangeId ?? null;
      if ((intoServiceId === null) === (intoChangeId === null)) {
        throw new ValidationError("REQUIRED", "into", "Choose the service to merge into.");
      }
      if (intoServiceId === service.id) {
        throw new ValidationError("SELF_LINK", "into", "A service cannot be merged into itself.");
      }
      if (intoServiceId !== null) {
        this.requireExists("service", intoServiceId, "into");
        if (changes.some((c) => (c.kind === "retire" || c.kind === "merge") && c.serviceId === intoServiceId)) {
          throw new ValidationError(
            "INVALID_VALUE",
            "into",
            "That service is retired or merged away in this scenario.",
          );
        }
      } else if (!changes.some((c) => c.kind === "add" && c.id === intoChangeId)) {
        throw new ValidationError("NOT_FOUND", "into", "Choose a service this scenario adds.");
      }
      return [service.id, intoServiceId, intoChangeId, null, null, null, null, null];
    }

    this.requireExists("network", input.networkId, "network");
    const providerOrgId = this.optionalRef("organization", input.providerOrgId, "provider");
    const moves = input.networkId !== service.networkId;
    if (!moves && (providerOrgId === null || providerOrgId === service.providerOrgId)) {
      throw new ValidationError("INVALID_VALUE", "network", "Choose another network or another provider.");
    }
    return [service.id, null, null, input.networkId, providerOrgId, null, null, null];
  }

  // ---- map positions ----

  listPositions(): NodePosition[] {
    return POSITIONED.flatMap((entity) =>
      this.rows(`SELECT id, map_x, map_y FROM ${entity} WHERE map_x IS NOT NULL ORDER BY id`).map((r) => ({
        entity,
        id: Number(r["id"]),
        x: Number(r["map_x"]),
        y: Number(r["map_y"]),
      })),
    );
  }

  /**
   * Save where nodes sit on the map, in one write. Positions are rounded to a tenth of a unit, and
   * when none of them changed nothing is written and nobody is notified, so reopening an arranged
   * dataset does not mark it unsaved.
   */
  setPositions(positions: readonly NodePosition[], history: History = "own"): void {
    const rounded = positions.map((p) => {
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > MAX_COORDINATE ||
        Math.abs(p.y) > MAX_COORDINATE
      ) {
        throw new ValidationError("INVALID_VALUE", "position", "A map position is out of range.");
      }
      return { ...p, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    });
    const saved = new Map(this.listPositions().map((p) => [`${p.entity}-${String(p.id)}`, p]));
    const changed = rounded.filter((p) => {
      const old = saved.get(`${p.entity}-${String(p.id)}`);
      return old?.x !== p.x || old.y !== p.y;
    });
    if (changed.length === 0) return;
    this.write(
      () => {
        for (const p of changed) {
          this.update(`UPDATE ${p.entity} SET map_x = ?, map_y = ? WHERE id = ?`, [p.x, p.y, p.id], p.entity);
        }
      },
      "position",
      history,
    );
  }

  // ---- derived views ----

  /** The dataset's name from its meta table. */
  datasetName(): string {
    return datasetName(this.db);
  }

  /** Rename document metadata through the same validated, undoable write path as inventory. */
  renameDataset(value: string, options: WriteOptions = {}): void {
    const name = cleanName(value, "dataset name");
    checkSensitive({ "Dataset name": name }, options.confirmSensitive ?? false);
    if (name === this.datasetName()) return;
    this.write(() => {
      this.db.run(
        "INSERT INTO meta (key, value) VALUES ('name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [name],
      );
    }, "dataset");
  }

  /** The dataset's banner caveat, e.g. "REL TO USA, FVEY" (Q-029), or null. */
  datasetCaveat(): string | null {
    const value = this.row("SELECT value FROM meta WHERE key = 'caveat'", [])?.["value"];
    return typeof value === "string" ? value : null;
  }

  /** Set or (with null or blank text) clear the banner caveat. */
  setCaveat(value: string | null): void {
    const caveat = normalizeCaveat(value);
    if (caveat !== null && !isValidCaveat(caveat)) {
      throw new ValidationError(
        "INVALID_VALUE",
        "caveat",
        "A caveat may use up to 80 letters, digits, spaces, commas, hyphens and slashes.",
      );
    }
    if (this.datasetCaveat() === caveat) return;
    this.write(() => {
      if (caveat === null) this.db.run("DELETE FROM meta WHERE key = 'caveat'");
      else
        this.db.run(
          "INSERT INTO meta (key, value) VALUES ('caveat', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [caveat],
        );
    }, "caveat");
  }

  /** The banner marking: the highest marking on any network or service (CON-002). */
  datasetMarking(): Marking {
    return highestMarking(
      // A service a scenario adds counts too: the banner shows the highest marking in the file.
      this.rows(
        "SELECT marking FROM network UNION SELECT marking FROM service " +
          "UNION SELECT marking FROM scenario_change WHERE marking IS NOT NULL",
      ).map((r) => requireMarking(r["marking"])),
    );
  }

  snapshot(): Snapshot {
    const networks = this.listNetworks();
    const markingOf = new Map(networks.map((n) => [n.id, n.marking]));
    return {
      marking: this.datasetMarking(),
      caveat: this.datasetCaveat(),
      networks,
      services: this.listServices(),
      // A CDS is classified by the networks it joins (Q-030).
      cds: this.listCds().map((c) => ({
        ...c,
        marking: highestMarking(c.networkIds.map((id) => markingOf.get(id) ?? "UNCLASSIFIED")),
      })),
      organizations: this.listOrganizations(),
      applications: this.listApplications(),
      categories: this.listCategories(),
      support: this.listSupport(),
      consumption: this.listConsumption(),
      dependencies: this.listDependencies(),
      positions: this.listPositions(),
      scenarios: this.listScenarios(),
      scenarioChanges: this.listScenarioChanges(),
    };
  }

  // ---- plumbing ----

  /**
   * Run many writes as one: a single undo step (the first write that changes anything starts it,
   * never merging into an earlier edit) and a single change notification at the end, if anything
   * was written. Used by CSV import.
   */
  group<T>(action: () => T): T {
    const outer = this.grouping === 0;
    if (outer) {
      this.groupStepStarted = false;
      this.groupWrote = false;
    }
    this.grouping++;
    try {
      return action();
    } finally {
      this.grouping--;
      if (outer && this.groupWrote) this.notify("group");
    }
  }

  /** One synchronous, rollback-safe command over existing repository writes. */
  atomic<T>(action: () => T): T {
    if (this.atomicRunning) return this.withSavepoint(action);

    const start = this.lastLogged();
    const undoBefore = [...this.undoSteps];
    const redoBefore = [...this.redoSteps];
    const mergeableBefore = this.mergeable;
    const groupStepBefore = this.groupStepStarted;
    const groupWroteBefore = this.groupWrote;
    this.db.run("BEGIN");
    this.atomicRunning = true;
    let result: T;
    let changed: boolean;
    try {
      result = action();
      this.requireSynchronous(result);
      changed = this.lastLogged() > start;
      if (changed) {
        const recorded = this.record(start, this.grouping > 0 && this.groupStepStarted ? "merge" : "own");
        if (this.grouping > 0) {
          if (recorded) this.groupStepStarted = true;
          this.groupWrote = true;
        }
      }
      this.db.run("COMMIT");
    } catch (error) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // SQLite may already have rolled back; retain the original error.
      }
      this.undoSteps.splice(0, this.undoSteps.length, ...undoBefore);
      this.redoSteps.splice(0, this.redoSteps.length, ...redoBefore);
      this.mergeable = mergeableBefore;
      this.groupStepStarted = groupStepBefore;
      this.groupWrote = groupWroteBefore;
      throw error;
    } finally {
      this.atomicRunning = false;
    }
    if (changed && this.grouping === 0) this.notify("command");
    return result;
  }

  private withSavepoint<T>(action: () => T): T {
    const name = `sim_command_${String(++this.savepointSerial)}`;
    this.db.run(`SAVEPOINT ${name}`);
    try {
      const result = action();
      this.requireSynchronous(result);
      this.db.run(`RELEASE ${name}`);
      return result;
    } catch (error) {
      try {
        this.db.run(`ROLLBACK TO ${name}`);
        this.db.run(`RELEASE ${name}`);
      } catch {
        // Keep the cause; the outer command will roll back if necessary.
      }
      throw error;
    }
  }

  private requireSynchronous(value: unknown): void {
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function") &&
      typeof (value as { then?: unknown }).then === "function"
    ) {
      throw new Error("An atomic command must be synchronous.");
    }
  }

  private write<T>(action: () => T, entity: string, history: History = "own"): T {
    if (this.atomicRunning) {
      try {
        return this.withSavepoint(action);
      } catch (error) {
        throw translate(error, entity);
      }
    }
    const start = this.lastLogged();
    const undoBefore = [...this.undoSteps];
    const redoBefore = [...this.redoSteps];
    const mergeableBefore = this.mergeable;
    const groupStepBefore = this.groupStepStarted;
    const groupWroteBefore = this.groupWrote;
    this.db.run("BEGIN");
    let result: T;
    let changed: boolean;
    try {
      result = action();
      this.requireSynchronous(result);
      changed = this.lastLogged() > start;
      if (changed) {
        if (this.grouping > 0) {
          const recorded = this.record(start, this.groupStepStarted ? "merge" : "own");
          if (recorded) this.groupStepStarted = true;
          this.groupWrote = true;
        } else {
          this.record(start, history);
        }
      }
      this.db.run("COMMIT");
    } catch (error) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // Already rolled back by SQLite; report the original error.
      }
      this.undoSteps.splice(0, this.undoSteps.length, ...undoBefore);
      this.redoSteps.splice(0, this.redoSteps.length, ...redoBefore);
      this.mergeable = mergeableBefore;
      this.groupStepStarted = groupStepBefore;
      this.groupWrote = groupWroteBefore;
      throw translate(error, entity);
    }
    if (changed && this.grouping === 0) this.notify(entity, history);
    return result;
  }

  // ---- undo and redo ----

  canUndo(): boolean {
    return this.undoSteps.length > 0;
  }

  canRedo(): boolean {
    return this.redoSteps.length > 0;
  }

  /** Reverse the latest step; false when there is nothing to undo. */
  undo(): boolean {
    return this.replay(this.undoSteps, this.redoSteps);
  }

  /** Re-apply the latest undone step; false when there is nothing to redo. */
  redo(): boolean {
    return this.replay(this.redoSteps, this.undoSteps);
  }

  /** Fresh history for this repository, replacing any from an earlier repository on the same database. */
  private installUndo(): void {
    for (const r of this.rows(
      "SELECT name FROM temp.sqlite_master WHERE type = 'trigger' AND name LIKE 'undo!_%' ESCAPE '!'",
    )) {
      this.db.run(`DROP TRIGGER temp.${String(r["name"])}`);
    }
    this.db.run("DROP TABLE IF EXISTS temp.undo_log");
    this.db.run("CREATE TEMP TABLE undo_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, sql TEXT NOT NULL)");
    const tables = this.rows("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
    for (const { name } of tables) {
      const table = String(name);
      const columns = this.rows(`SELECT name FROM pragma_table_info('${table}')`).map((c) => String(c["name"]));
      const values = (row: "old" | "new") => columns.map((c) => `quote(${row}.${c})`).join(" || ',' || ");
      const sets = columns.map((c) => `'${c} = ' || quote(old.${c})`).join(" || ', ' || ");
      const log = (sql: string) => `INSERT INTO undo_log (sql) VALUES (${sql});`;
      this.db.run(
        `CREATE TEMP TRIGGER undo_${table}_insert AFTER INSERT ON main.${table} BEGIN ` +
          log(`'DELETE FROM main.${table} WHERE rowid = ' || new.rowid`) +
          " END",
      );
      this.db.run(
        `CREATE TEMP TRIGGER undo_${table}_update AFTER UPDATE ON main.${table} BEGIN ` +
          log(`'UPDATE main.${table} SET ' || ${sets} || ' WHERE rowid = ' || old.rowid`) +
          " END",
      );
      this.db.run(
        `CREATE TEMP TRIGGER undo_${table}_delete AFTER DELETE ON main.${table} BEGIN ` +
          log(
            `'INSERT INTO main.${table} (rowid, ${columns.join(", ")}) VALUES (' || old.rowid || ',' || ${values("old")} || ')'`,
          ) +
          " END",
      );
    }
  }

  private lastLogged(): number {
    return Number(this.db.exec("SELECT coalesce(max(seq), 0) FROM undo_log")[0]?.values[0]?.[0] ?? 0);
  }

  private forget(steps: readonly Step[]): void {
    for (const step of steps) this.db.run("DELETE FROM undo_log WHERE seq BETWEEN ? AND ?", [step.from, step.to]);
  }

  /** File the rows a successful write logged after `start` under the history rule. */
  private record(start: number, history: History): boolean {
    const end = this.lastLogged();
    if (end === start) return false;
    const step = { from: start + 1, to: end };
    if (history === "none") {
      this.forget([step]);
      this.mergeable = false;
      return false;
    }
    const last = this.undoSteps.at(-1);
    if (history === "merge" && this.mergeable && last) {
      this.undoSteps[this.undoSteps.length - 1] = { from: last.from, to: end };
    } else {
      this.undoSteps.push(step);
      this.forget(this.redoSteps.splice(0));
      if (this.undoSteps.length > MAX_UNDO_STEPS) this.forget(this.undoSteps.splice(0, 1));
    }
    this.mergeable = true;
    return true;
  }

  /** Run one step's reversing SQL newest first; what it logs becomes the opposite step. */
  private replay(from: Step[], to: Step[]): boolean {
    const step = from.at(-1);
    if (!step) return false;
    const statements = this.rows("SELECT sql FROM undo_log WHERE seq BETWEEN ? AND ? ORDER BY seq DESC", [
      step.from,
      step.to,
    ]).map((r) => String(r["sql"]));
    const start = this.lastLogged();
    this.db.run("BEGIN");
    let end: number;
    try {
      // Rows come back in reverse order, so a child may return before its parent within the step.
      this.db.run("PRAGMA defer_foreign_keys = ON");
      this.db.run("DELETE FROM undo_log WHERE seq BETWEEN ? AND ?", [step.from, step.to]);
      for (const sql of statements) this.db.run(sql);
      end = this.lastLogged();
      this.db.run("COMMIT");
    } catch (error) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // Already rolled back.
      }
      throw error;
    }
    from.pop();
    if (end > start) to.push({ from: start + 1, to: end });
    this.mergeable = false;
    this.notify("history");
    return true;
  }

  private insert(sql: string, params: SqlValue[]): number {
    this.db.run(sql, params);
    const exact = this.db.exec("SELECT CAST(last_insert_rowid() AS TEXT)")[0]?.values[0]?.[0];
    if (typeof exact !== "string" || !/^-?[0-9]+$/.test(exact)) {
      throw new Error("SQLite did not return an exact generated ID.");
    }
    const id = BigInt(exact);
    const limit = BigInt(Number.MAX_SAFE_INTEGER);
    if (id < -limit || id > limit) {
      throw new ValidationError(
        "UNSAFE_ID",
        "id",
        "This dataset has no safe generated IDs remaining for a new record.",
      );
    }
    return Number(id);
  }

  private update(sql: string, params: SqlValue[], entity: string): void {
    this.db.run(sql, params);
    if (this.db.getRowsModified() === 0) {
      throw new ValidationError("NOT_FOUND", entity, `That ${entity} no longer exists.`);
    }
  }

  private rows(sql: string, params: SqlValue[] = []): Row[] {
    const statement = this.db.prepare(sql, params);
    try {
      const out: Row[] = [];
      while (statement.step()) out.push(statement.getAsObject());
      return out;
    } finally {
      statement.free();
    }
  }

  private row(sql: string, params: SqlValue[]): Row | undefined {
    return this.rows(sql, params)[0];
  }

  /**
   * Run inside a write after changing a CDS or a service: every route through a CDS must still connect
   * two different networks that the CDS joins (the rule addDependency enforces). Throwing rolls back.
   */
  private requireValidRoutes(field: string): void {
    const broken = this.row(
      `SELECT c.id AS consumer_id, p.id AS provider_id, x.id AS cds_id, c.name AS consumer, p.name AS provider, x.name AS cds
       FROM service_dependency d
       JOIN service c ON c.id = d.consumer_service_id
       JOIN service p ON p.id = d.provider_service_id
       JOIN cds x ON x.id = d.via_cds_id
       WHERE c.network_id = p.network_id
          OR NOT EXISTS (SELECT 1 FROM cds_network n WHERE n.cds_id = x.id AND n.network_id = c.network_id)
          OR NOT EXISTS (SELECT 1 FROM cds_network n WHERE n.cds_id = x.id AND n.network_id = p.network_id)
       LIMIT 1`,
      [],
    );
    if (broken) {
      const [consumer, provider, cds] = [broken["consumer"], broken["provider"], broken["cds"]].map(String);
      throw new ValidationError(
        "CDS_ROUTE",
        field,
        `This would break the route from ${consumer ?? ""} to ${provider ?? ""} through ${cds ?? ""}; change or remove that dependency first.`,
        this.routeDiagnosticTargets(
          Number(broken["consumer_id"]),
          Number(broken["provider_id"]),
          Number(broken["cds_id"]),
        ),
      );
    }
  }

  /** Keep existing readable legacy route issues repairable while refusing new or worsened issues. */
  private routeDiagnosticTargets(consumerId: number, providerId: number, cdsId: number): DiagnosticTarget[] {
    const consumer = this.getService(consumerId);
    const provider = this.getService(providerId);
    const cds = this.getCds(cdsId);
    return [
      ...(consumer
        ? [{ type: "service" as const, id: consumer.id, label: `Inspect consuming service ${consumer.name}` }]
        : []),
      ...(provider
        ? [{ type: "service" as const, id: provider.id, label: `Inspect providing service ${provider.name}` }]
        : []),
      ...(cds ? [{ type: "cds" as const, id: cds.id, label: `Inspect route CDS ${cds.name}` }] : []),
    ];
  }

  private brokenRoutes(): Map<string, ValidationError> {
    const rows = this.rows(
      `SELECT d.consumer_service_id AS consumer_id, d.provider_service_id AS provider_id, d.via_cds_id AS cds_id,
              c.network_id AS consumer_network, p.network_id AS provider_network,
              c.name AS consumer, p.name AS provider, x.name AS cds,
              c.network_id = p.network_id AS same_network,
              NOT EXISTS (SELECT 1 FROM cds_network n WHERE n.cds_id = x.id AND n.network_id = c.network_id) AS missing_consumer,
              NOT EXISTS (SELECT 1 FROM cds_network n WHERE n.cds_id = x.id AND n.network_id = p.network_id) AS missing_provider
       FROM service_dependency d
       JOIN service c ON c.id = d.consumer_service_id
       JOIN service p ON p.id = d.provider_service_id
       JOIN cds x ON x.id = d.via_cds_id
       WHERE c.network_id = p.network_id
          OR NOT EXISTS (SELECT 1 FROM cds_network n WHERE n.cds_id = x.id AND n.network_id = c.network_id)
          OR NOT EXISTS (SELECT 1 FROM cds_network n WHERE n.cds_id = x.id AND n.network_id = p.network_id)`,
      [],
    );
    const broken = new Map<string, ValidationError>();
    for (const row of rows) {
      const signature = JSON.stringify([
        row["consumer_id"],
        row["provider_id"],
        row["cds_id"],
        row["consumer_network"],
        row["provider_network"],
        row["same_network"],
        row["missing_consumer"],
        row["missing_provider"],
      ]);
      broken.set(
        signature,
        new ValidationError(
          "CDS_ROUTE",
          "network",
          `This would break the route from ${String(row["consumer"])} to ${String(row["provider"])} through ${String(row["cds"])}; change or remove that dependency first.`,
          this.routeDiagnosticTargets(Number(row["consumer_id"]), Number(row["provider_id"]), Number(row["cds_id"])),
        ),
      );
    }
    return broken;
  }

  private requireNoNewInvalidRoutes(before: Map<string, ValidationError>, field: string): void {
    for (const [signature, diagnostic] of this.brokenRoutes()) {
      if (!before.has(signature)) throw new ValidationError("CDS_ROUTE", field, diagnostic.message, diagnostic.targets);
    }
  }

  private requireExists(table: string, id: number, field: string): void {
    if (!this.row(`SELECT 1 FROM ${table} WHERE id = ?`, [id])) {
      throw new ValidationError("NOT_FOUND", field, `The selected ${field} does not exist.`);
    }
  }

  private optionalRef(table: string, id: number | null | undefined, field: string): number | null {
    if (id === null || id === undefined) return null;
    this.requireExists(table, id, field);
    return id;
  }

  private mustGet<T>(value: T | undefined): T {
    if (value === undefined) throw new Error("row vanished inside its own transaction");
    return value;
  }
}

/** Keep the exact bytes of a readable legacy field until it is actually edited. */
function unchangedName(value: string, stored: string | undefined, field: string): string {
  return stored !== undefined && value === stored ? stored : cleanName(value, field);
}

function unchangedText(value: string | null | undefined, stored: string | null | undefined): string | null {
  return stored !== undefined && value === stored ? stored : cleanText(value);
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function translate(error: unknown, entity: string): unknown {
  if (error instanceof ValidationError || error instanceof SensitiveInputWarning) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE constraint failed") || message.includes("PRIMARY KEY")) {
    const field = NAME_FIELD[entity] ?? entity;
    const scope = entity === "service" ? " on that network" : "";
    return new ValidationError("DUPLICATE", field, `That ${entity} already exists${scope}.`);
  }
  if (message.includes("FOREIGN KEY constraint failed")) {
    return new ValidationError("IN_USE", entity, `That ${entity} is still in use; remove what depends on it first.`);
  }
  return error;
}

// Runtime checks on values that are typed but may arrive untyped (CSV import, opened files).
function requireKind(value: unknown): NetworkKind {
  if (value !== "internal" && value !== "external") {
    throw new ValidationError("INVALID_VALUE", "kind", "A network must be internal or external.");
  }
  return value;
}

function requireTier(value: unknown): Tier {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new ValidationError("INVALID_VALUE", "tier", "Support tier must be 1, 2 or 3.");
  }
  return value;
}

function requireMarking(value: unknown): Marking {
  if (!isMarking(value))
    throw new ValidationError("INVALID_VALUE", "marking", "Choose a valid classification marking.");
  return value;
}

const text = (value: SqlValue | undefined): string | null => (typeof value === "string" ? value : null);
const id = (value: SqlValue | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

const toNetwork = (r: Row): Network => ({
  id: Number(r["id"]),
  name: String(r["name"]),
  kind: r["kind"] === "external" ? "external" : "internal",
  marking: requireMarking(r["marking"]),
  description: text(r["description"]),
});

const toOrganization = (r: Row): Organization => ({
  id: Number(r["id"]),
  name: String(r["name"]),
  parentId: id(r["parent_id"]),
});

const toCategory = (r: Row): Category => ({ id: Number(r["id"]), name: String(r["name"]), color: text(r["color"]) });

const toApplication = (r: Row): Application => ({
  id: Number(r["id"]),
  name: String(r["name"]),
  vendor: text(r["vendor"]),
  description: text(r["description"]),
});

const toScenario = (r: Row): Scenario => ({
  id: Number(r["id"]),
  name: String(r["name"]),
  description: text(r["description"]),
});

function toScenarioChange(r: Row): ScenarioChange {
  const base = { id: Number(r["id"]), scenarioId: Number(r["scenario_id"]) };
  switch (r["kind"]) {
    case "add":
      return {
        ...base,
        kind: "add",
        name: String(r["name"]),
        networkId: Number(r["network_id"]),
        marking: requireMarking(r["marking"]),
        providerOrgId: id(r["provider_org_id"]),
        description: text(r["description"]),
      };
    case "retire":
      return { ...base, kind: "retire", serviceId: Number(r["service_id"]) };
    case "merge":
      return {
        ...base,
        kind: "merge",
        serviceId: Number(r["service_id"]),
        intoServiceId: id(r["into_service_id"]),
        intoChangeId: id(r["into_change_id"]),
      };
    default:
      return {
        ...base,
        kind: "rehome",
        serviceId: Number(r["service_id"]),
        networkId: Number(r["network_id"]),
        providerOrgId: id(r["provider_org_id"]),
      };
  }
}

const toService = (r: Row): Service => ({
  id: Number(r["id"]),
  name: String(r["name"]),
  networkId: Number(r["network_id"]),
  applicationId: id(r["application_id"]),
  categoryId: id(r["category_id"]),
  providerOrgId: id(r["provider_org_id"]),
  marking: requireMarking(r["marking"]),
  foundational: r["foundational"] === 1,
  description: text(r["description"]),
});
