import type { Database } from "sql.js";

export type DatasetIssueCode =
  "UNSAFE_ID" | "ORG_CYCLE" | "CDS_ARITY" | "CDS_ROUTE" | "SCENARIO_TARGET" | "SCENARIO_CHAIN";

/** A stored-row witness. Legacy issues are readable; unsafe IDs cannot be represented by repository numbers. */
export interface DatasetIssue {
  readonly code: DatasetIssueCode;
  readonly table: string;
  readonly rowId: string;
  readonly witness: string;
  readonly severity: "unsafe" | "legacy";
}

// These are persisted identities or references that the repository converts to JavaScript numbers.
// Keep this list aligned with the supported v1-v3 schema, including composite-key tables.
const ID_COLUMNS = {
  network: ["id"],
  organization: ["id", "parent_id"],
  category: ["id"],
  application: ["id"],
  service: ["id", "network_id", "application_id", "category_id", "provider_org_id"],
  support_assignment: ["service_id", "org_id"],
  cds: ["id"],
  cds_network: ["cds_id", "network_id"],
  org_consumes: ["org_id", "service_id"],
  service_dependency: ["consumer_service_id", "provider_service_id", "via_cds_id"],
  scenario: ["id"],
  scenario_change: [
    "id",
    "scenario_id",
    "service_id",
    "into_service_id",
    "into_change_id",
    "network_id",
    "provider_org_id",
  ],
} as const;

const MAX_SAFE_ID = "9007199254740991";

function values(db: Database, sql: string): unknown[][] {
  return db.exec(sql)[0]?.values ?? [];
}

function cycles(next: ReadonlyMap<number, number | null>): number[][] {
  const completed = new Set<number>();
  const found: number[][] = [];
  for (const start of next.keys()) {
    if (completed.has(start)) continue;
    const path: number[] = [];
    const index = new Map<number, number>();
    let at: number | null = start;
    while (at !== null && next.has(at) && !completed.has(at)) {
      const first = index.get(at);
      if (first !== undefined) {
        found.push(path.slice(first));
        break;
      }
      index.set(at, path.length);
      path.push(at);
      at = next.get(at) ?? null;
    }
    for (const id of path) completed.add(id);
  }
  return found;
}

/** Inspect supported-schema rows without changing them. Call after structural and FK validation. */
export function inspectDatasetSemantics(db: Database): DatasetIssue[] {
  const issues: DatasetIssue[] = [];
  const tables = new Set(
    values(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row[0])),
  );

  // CAST happens inside SQLite, before sql.js can round an INTEGER to a JS number.
  for (const [table, columns] of Object.entries(ID_COLUMNS)) {
    if (!tables.has(table)) continue;
    for (const column of columns) {
      const bad = values(
        db,
        `SELECT CAST(rowid AS TEXT), CAST(${column} AS TEXT) FROM ${table} ` +
          `WHERE ${column} > ${MAX_SAFE_ID} OR ${column} < -${MAX_SAFE_ID} LIMIT 1`,
      )[0];
      if (bad) {
        issues.push({
          code: "UNSAFE_ID",
          table,
          rowId: String(bad[0]),
          witness: `${table}.${column}=${String(bad[1])}`,
          severity: "unsafe",
        });
      }
    }
  }
  if (issues.length > 0) return issues;

  const parents = new Map<number, number | null>(
    values(db, "SELECT id, parent_id FROM organization ORDER BY id").map((row) => [
      Number(row[0]),
      row[1] === null ? null : Number(row[1]),
    ]),
  );
  for (const cycle of cycles(parents)) {
    issues.push({
      code: "ORG_CYCLE",
      table: "organization",
      rowId: String(cycle[0]),
      witness: `parent cycle ${[...cycle, cycle[0]].join(" -> ")}`,
      severity: "legacy",
    });
  }

  const cdsNetworks = new Map<number, number[]>();
  for (const row of values(db, "SELECT id FROM cds ORDER BY id")) cdsNetworks.set(Number(row[0]), []);
  for (const row of values(db, "SELECT cds_id, network_id FROM cds_network ORDER BY cds_id, network_id")) {
    cdsNetworks.get(Number(row[0]))?.push(Number(row[1]));
  }
  for (const [id, networkIds] of cdsNetworks) {
    if (networkIds.length < 2) {
      issues.push({
        code: "CDS_ARITY",
        table: "cds",
        rowId: String(id),
        witness: `CDS ${String(id)} joins ${String(networkIds.length)} network(s): ${networkIds.join(",")}`,
        severity: "legacy",
      });
    }
  }

  const serviceNetworks = new Map<number, number>(
    values(db, "SELECT id, network_id FROM service").map((row) => [Number(row[0]), Number(row[1])]),
  );
  for (const row of values(
    db,
    "SELECT consumer_service_id, provider_service_id, via_cds_id FROM service_dependency WHERE via_cds_id IS NOT NULL",
  )) {
    const consumer = Number(row[0]);
    const provider = Number(row[1]);
    const cds = Number(row[2]);
    const from = serviceNetworks.get(consumer);
    const to = serviceNetworks.get(provider);
    const joined = cdsNetworks.get(cds) ?? [];
    if (from === to || from === undefined || to === undefined || !joined.includes(from) || !joined.includes(to)) {
      issues.push({
        code: "CDS_ROUTE",
        table: "service_dependency",
        rowId: `${String(consumer)}:${String(provider)}`,
        witness: `route ${String(consumer)}(${String(from)}) -> ${String(provider)}(${String(to)}) via ${String(cds)} [${joined.join(",")}]`,
        severity: "legacy",
      });
    }
  }

  if (tables.has("scenario_change")) {
    type Change = {
      id: number;
      scenario: number;
      kind: string;
      service: number | null;
      intoService: number | null;
      intoChange: number | null;
    };
    const changes: Change[] = values(
      db,
      "SELECT id, scenario_id, kind, service_id, into_service_id, into_change_id FROM scenario_change ORDER BY scenario_id, id",
    ).map((row) => ({
      id: Number(row[0]),
      scenario: Number(row[1]),
      kind: String(row[2]),
      service: row[3] === null ? null : Number(row[3]),
      intoService: row[4] === null ? null : Number(row[4]),
      intoChange: row[5] === null ? null : Number(row[5]),
    }));
    const byId = new Map(changes.map((change) => [change.id, change]));
    const byScenario = new Map<number, Change[]>();
    for (const change of changes) {
      const existing = byScenario.get(change.scenario) ?? [];
      existing.push(change);
      byScenario.set(change.scenario, existing);
      if (change.kind === "merge" && change.intoChange !== null && byId.get(change.intoChange)?.kind !== "add") {
        issues.push({
          code: "SCENARIO_TARGET",
          table: "scenario_change",
          rowId: String(change.id),
          witness: `merge ${String(change.id)} targets non-add change ${String(change.intoChange)}`,
          severity: "legacy",
        });
      }
    }
    for (const [scenario, group] of byScenario) {
      const byService = new Map(group.filter((c) => c.service !== null).map((c) => [c.service, c]));
      const merges = new Map<number, number | null>();
      for (const change of group) {
        if (change.kind !== "merge" || change.service === null) continue;
        if (change.intoService !== null) {
          const target = byService.get(change.intoService);
          if (target && (target.kind === "merge" || target.kind === "retire")) {
            issues.push({
              code: "SCENARIO_TARGET",
              table: "scenario_change",
              rowId: String(change.id),
              witness: `scenario ${String(scenario)} merge ${String(change.id)} targets ${target.kind} service ${String(change.intoService)}`,
              severity: "legacy",
            });
          }
        }
        merges.set(change.service, change.intoService);
      }
      for (const cycle of cycles(merges)) {
        const start = cycle[0];
        if (start === undefined) continue;
        issues.push({
          code: "SCENARIO_CHAIN",
          table: "scenario_change",
          rowId: String(byService.get(start)?.id),
          witness: `scenario ${String(scenario)} merge cycle ${[...cycle, start].join(" -> ")}`,
          severity: "legacy",
        });
      }
    }
  }

  return issues;
}
