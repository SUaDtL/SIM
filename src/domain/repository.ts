import type { Database, SqlValue } from "sql.js";
import { datasetName } from "../db/dataset";
import { highestMarking, isMarking, isValidCaveat, type Marking, normalizeCaveat } from "../db/markings";
import { SensitiveInputWarning, ValidationError } from "./errors";
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
  Network,
  NetworkInput,
  NetworkKind,
  NodePosition,
  Organization,
  OrganizationInput,
  Service,
  ServiceInput,
  Snapshot,
  SupportAssignment,
  Tier,
  WriteOptions,
} from "./types";
import { checkSensitive, cleanName, cleanText } from "./validate";

type Row = Record<string, SqlValue>;
type Listener = () => void;

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
};

/**
 * The only write path to a SIM dataset (coding standard CONV-002). Every write is validated,
 * runs in a transaction, and notifies subscribers only when it succeeds.
 */
export class Repository {
  private readonly listeners = new Set<Listener>();

  constructor(private readonly db: Database) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    const v = this.network(input, options);
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

  private network(input: NetworkInput, options: WriteOptions): SqlValue[] {
    const name = cleanName(input.name, NAME_FIELD["network"] ?? "name");
    const kind = requireKind(input.kind);
    const marking = requireMarking(input.marking);
    const description = cleanText(input.description);
    checkSensitive({ "network name": name, description }, options.confirmSensitive === true);
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
    const name = cleanName(input.name, NAME_FIELD["organization"] ?? "name");
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      this.requireExists("organization", parentId, "parent");
      // Walk up from the proposed parent; reaching this organization would close a loop.
      for (let at: number | null = parentId; at !== null; at = this.getOrganization(at)?.parentId ?? null) {
        if (at === id) throw new ValidationError("CYCLE", "parent", "An organization cannot be nested under itself.");
      }
    }
    checkSensitive({ "organization name": name }, options.confirmSensitive === true);
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
    const v = this.category(input, options);
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

  private category(input: CategoryInput, options: WriteOptions): SqlValue[] {
    const name = cleanName(input.name, NAME_FIELD["category"] ?? "name");
    const color = cleanText(input.color);
    if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) {
      throw new ValidationError("INVALID_VALUE", "color", "A color must look like #1a2b3c.");
    }
    checkSensitive({ "category name": name }, options.confirmSensitive === true);
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
    const v = this.application(input, options);
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

  private application(input: ApplicationInput, options: WriteOptions): SqlValue[] {
    const name = cleanName(input.name, NAME_FIELD["application"] ?? "name");
    const vendor = cleanText(input.vendor);
    const description = cleanText(input.description);
    checkSensitive({ "application name": name, vendor, description }, options.confirmSensitive === true);
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

  updateService(id: number, input: ServiceInput, options: WriteOptions = {}): Service {
    const v = this.service(input, options);
    return this.write(() => {
      this.update(
        `UPDATE service SET name = ?, network_id = ?, application_id = ?, category_id = ?, provider_org_id = ?,
         marking = ?, foundational = ?, description = ? WHERE id = ?`,
        [...v, id],
        "service",
      );
      this.requireValidRoutes("network");
      return this.mustGet(this.getService(id));
    }, "service");
  }

  deleteService(id: number): void {
    this.write(() => {
      this.update("DELETE FROM service WHERE id = ?", [id], "service");
    }, "service");
  }

  private service(input: ServiceInput, options: WriteOptions): SqlValue[] {
    const name = cleanName(input.name, NAME_FIELD["service"] ?? "name");
    this.requireExists("network", input.networkId, "network");
    const applicationId = this.optionalRef("application", input.applicationId, "application");
    const categoryId = this.optionalRef("category", input.categoryId, "category");
    const providerOrgId = this.optionalRef("organization", input.providerOrgId, "provider");
    const marking = requireMarking(input.marking);
    const description = cleanText(input.description);
    checkSensitive({ "service name": name, description }, options.confirmSensitive === true);
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
    const { name, description, networkIds } = this.cds(input, options);
    return this.write(() => {
      this.update("UPDATE cds SET name = ?, description = ? WHERE id = ?", [name, description, id], "CDS");
      this.setCdsNetworks(id, networkIds);
      this.requireValidRoutes("networks");
      return this.mustGet(this.getCds(id));
    }, "cds");
  }

  deleteCds(id: number): void {
    this.write(() => {
      this.update("DELETE FROM cds WHERE id = ?", [id], "CDS");
    }, "cds");
  }

  private cds(input: CdsInput, options: WriteOptions) {
    const name = cleanName(input.name, NAME_FIELD["cds"] ?? "name");
    const networkIds = [...new Set(input.networkIds)].sort((a, b) => a - b);
    if (networkIds.length < 2) {
      throw new ValidationError("CDS_NETWORKS", "networks", "A CDS must join at least two networks.");
    }
    for (const n of networkIds) this.requireExists("network", n, "networks");
    const description = cleanText(input.description);
    checkSensitive({ "CDS name": name, description }, options.confirmSensitive === true);
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
        throw new ValidationError("CDS_ROUTE", "via", "A CDS route must connect services on two different networks.");
      }
      if (!cds.networkIds.includes(consumer.networkId) || !cds.networkIds.includes(provider.networkId)) {
        throw new ValidationError("CDS_ROUTE", "via", `${cds.name} does not join both of these networks.`);
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
  setPositions(positions: readonly NodePosition[]): void {
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
    this.write(() => {
      for (const p of changed) {
        this.update(`UPDATE ${p.entity} SET map_x = ?, map_y = ? WHERE id = ?`, [p.x, p.y, p.id], p.entity);
      }
    }, "position");
  }

  // ---- derived views ----

  /** The dataset's name from its meta table. */
  datasetName(): string {
    return datasetName(this.db);
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
    this.write(() => {
      if (caveat === null) this.db.run("DELETE FROM meta WHERE key = 'caveat'");
      else this.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('caveat', ?)", [caveat]);
    }, "caveat");
  }

  /** The banner marking: the highest marking on any network or service (CON-002). */
  datasetMarking(): Marking {
    return highestMarking(
      this.rows("SELECT marking FROM network UNION SELECT marking FROM service").map((r) =>
        requireMarking(r["marking"]),
      ),
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
    };
  }

  // ---- plumbing ----

  private write<T>(action: () => T, entity: string): T {
    this.db.run("BEGIN");
    let result: T;
    try {
      result = action();
      this.db.run("COMMIT");
    } catch (error) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // Already rolled back by SQLite; report the original error.
      }
      throw translate(error, entity);
    }
    for (const listener of this.listeners) listener();
    return result;
  }

  private insert(sql: string, params: SqlValue[]): number {
    this.db.run(sql, params);
    return Number(this.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0]);
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
      `SELECT c.name AS consumer, p.name AS provider, x.name AS cds
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
      );
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
