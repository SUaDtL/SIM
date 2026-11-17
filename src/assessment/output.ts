import { bannerText } from "../db/markings";
import type { AssessmentContext, ExchangeTable } from "../domain/assessment-context";
import type { Repository } from "../domain/repository";
import type { Snapshot } from "../domain/types";
import { spreadsheetText, toCsv } from "../import/csv";
import { nodeId } from "../map/graph";
import type { AssessmentMapView } from "../map/map-view";
import { applyScenario, dependencyKey, serviceOrigin, type ProjectedSnapshot } from "../scenario/scenario";

const MAX_ROWS = 100_000;
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;

type Cell = string | number | boolean | null;
type Row = Readonly<Record<string, Cell>>;
type DataSource = Pick<
  Repository,
  "datasetName" | "assessmentContext" | "snapshot" | "exchangeIdentities" | "listAssessmentNotes"
>;

export interface InventorySection {
  readonly view: string;
  readonly totals: { readonly services: number; readonly dependencies: number };
  readonly tables: Readonly<Record<string, readonly Row[]>>;
}
export interface AssessmentOutput {
  readonly format: "sim-assessment/v1";
  readonly dataset: string;
  readonly lineage: string;
  readonly generated: string;
  readonly schema: number;
  readonly build: { readonly version: string; readonly commit: string; readonly modified: boolean };
  readonly marking: Snapshot["marking"];
  readonly caveat: string | null;
  readonly fileState: string;
  readonly scope: "all recorded inventory" | "current map scope";
  readonly details: Omit<AssessmentContext, "lineage" | "marking"> | null;
  readonly inventories: readonly InventorySection[];
  readonly map: string | null;
}

export function freezeAssessment(
  repo: DataSource,
  source: Pick<AssessmentOutput, "generated" | "schema" | "fileState" | "build">,
  mapView?: AssessmentMapView,
  includeNotes = false,
): AssessmentOutput {
  const snapshot = repo.snapshot();
  const notes = includeNotes ? repo.listAssessmentNotes() : [];
  const context = repo.assessmentContext();
  const identities = new Map<ExchangeTable, ReadonlyMap<string, string>>();
  const lookup = (table: ExchangeTable, ...key: number[]): string => {
    let values = identities.get(table);
    if (!values) {
      values = repo.exchangeIdentities(table);
      identities.set(table, values);
    }
    const identity = values.get(key.join(":"));
    if (!identity) throw new Error("An inventory record no longer has a stable identity.");
    return identity;
  };

  function inventory(data: Snapshot, view: string): InventorySection {
    const visible = mapView?.visibleNodes;
    const full = mapView === undefined;
    const selected = data.services.filter((service) => full || visible?.has(nodeId("service", service.id)));
    const serviceIds = new Set(selected.map((service) => service.id));
    const networks = new Map(data.networks.map((network) => [network.id, network]));
    const organizations = new Map(data.organizations.map((organization) => [organization.id, organization]));
    const cds = new Map(data.cds.map((record) => [record.id, record]));
    const serviceRef = (id: number): string => {
      const origin = serviceOrigin(data, id);
      return origin.kind === "baseline"
        ? lookup("service", origin.serviceId)
        : lookup("scenario_change", origin.changeId);
    };
    const name = (records: ReadonlyMap<number, { readonly name: string }>, id: number | null): string | null =>
      id === null ? null : (records.get(id)?.name ?? null);
    const reference = (table: ExchangeTable, id: number | null): string | null =>
      id === null ? null : lookup(table, id);
    const selectedNetworkIds = new Set(selected.map((service) => service.networkId));
    const relevantNetworks = data.networks.filter(
      (network) => full || selectedNetworkIds.has(network.id) || visible?.has(nodeId("network", network.id)),
    );
    const allowed = new Set(relevantNetworks.map((network) => network.id));
    const providerOrganizations = new Set(
      selected.flatMap((service) => (service.providerOrgId === null ? [] : [service.providerOrgId])),
    );
    const support = data.support.filter((row) => serviceIds.has(row.serviceId));
    const consumers = data.consumption.filter((row) => serviceIds.has(row.serviceId));
    for (const row of [...support, ...consumers]) providerOrganizations.add(row.orgId);
    const categoryIds = new Set(selected.map((row) => row.categoryId));
    const applicationIds = new Set(selected.map((row) => row.applicationId));
    const selectedCds = data.cds.filter((row) => full || visible?.has(nodeId("cds", row.id)));
    const allowedCds = new Set(selectedCds.map((row) => row.id));
    const dependencies = data.dependencies.filter(
      (row) =>
        serviceIds.has(row.consumerServiceId) &&
        serviceIds.has(row.providerServiceId) &&
        (full || mapView.visibleDependencies.has(dependencyKey(row))) &&
        (row.viaCdsId === null || allowedCds.has(row.viaCdsId)),
    );
    const byService = new Map(selected.map((service) => [service.id, service]));
    const qualified = (id: number): string => {
      const service = byService.get(id);
      if (!service) throw new Error("The export contains an unavailable service.");
      return `${service.name} (${name(networks, service.networkId) ?? "Network not recorded"})`;
    };
    const projected = "projection" in data ? (data as ProjectedSnapshot).projection : null;
    const names = new Map(data.categories.map((record) => [record.id, record]));
    const applications = new Map(data.applications.map((record) => [record.id, record]));
    const tables: Record<string, readonly Row[]> = {
      Networks: relevantNetworks.map(({ id, name, kind, description, marking }) => ({
        id: lookup("network", id),
        name,
        kind,
        description: full ? description : null,
        marking,
      })),
      Services: selected.map((row) => ({
        id: serviceRef(row.id),
        kind: serviceOrigin(data, row.id).kind,
        service: row.name,
        network: name(networks, row.networkId),
        networkId: lookup("network", row.networkId),
        provider: name(organizations, row.providerOrgId),
        providerId: reference("organization", row.providerOrgId),
        category: name(names, row.categoryId),
        categoryId: reference("category", row.categoryId),
        application: name(applications, row.applicationId),
        applicationId: reference("application", row.applicationId),
        marking: row.marking,
        foundational: row.foundational,
        description: row.description,
      })),
      Organizations: data.organizations
        .filter((row) => full || providerOrganizations.has(row.id))
        .map((row) => ({
          id: lookup("organization", row.id),
          name: row.name,
          parentId:
            full || (row.parentId !== null && providerOrganizations.has(row.parentId))
              ? reference("organization", row.parentId)
              : null,
        })),
      Categories: data.categories
        .filter((row) => full || categoryIds.has(row.id))
        .map(({ id, name, color }) => ({
          id: lookup("category", id),
          name,
          color,
        })),
      Applications: data.applications
        .filter((row) => full || applicationIds.has(row.id))
        .map(({ id, name, vendor, description }) => ({
          id: lookup("application", id),
          name,
          vendor: full ? vendor : null,
          description: full ? description : null,
        })),
      "Cross-domain solutions": selectedCds.map(({ id, name, description, marking }) => ({
        id: lookup("cds", id),
        name,
        description: full ? description : null,
        marking,
      })),
      "CDS network membership": selectedCds.flatMap((row) =>
        row.networkIds
          .filter((id) => allowed.has(id))
          .map((id) => ({
            id: lookup("cds_network", row.id, id),
            cdsId: lookup("cds", row.id),
            networkId: lookup("network", id),
            cds: row.name,
            network: name(networks, id),
          })),
      ),
      "Tiered support": support.map((row) => ({
        id: lookup("support_assignment", row.serviceId, row.tier),
        service: qualified(row.serviceId),
        serviceId: serviceRef(row.serviceId),
        tier: row.tier,
        organization: name(organizations, row.orgId),
        organizationId: lookup("organization", row.orgId),
        notes: full ? row.notes : null,
      })),
      "Consuming organizations": consumers.map((row) => ({
        id: projected ? null : lookup("org_consumes", row.orgId, row.serviceId),
        service: qualified(row.serviceId),
        serviceId: serviceRef(row.serviceId),
        organization: name(organizations, row.orgId),
        organizationId: lookup("organization", row.orgId),
      })),
      "Service dependencies": dependencies.map((row) => {
        const consumer = byService.get(row.consumerServiceId);
        const provider = byService.get(row.providerServiceId);
        const route = row.viaCdsId === null ? undefined : cds.get(row.viaCdsId);
        const from = consumer?.networkId;
        const to = provider?.networkId;
        const unresolved =
          projected?.dependencyProvenance.get(dependencyKey(row))?.status === "unresolved" ||
          (row.viaCdsId !== null &&
            (from === undefined ||
              to === undefined ||
              from === to ||
              !route?.networkIds.includes(from) ||
              !route.networkIds.includes(to)));
        return {
          id: projected ? null : lookup("service_dependency", row.consumerServiceId, row.providerServiceId),
          consumer: qualified(row.consumerServiceId),
          consumerId: serviceRef(row.consumerServiceId),
          provider: qualified(row.providerServiceId),
          providerId: serviceRef(row.providerServiceId),
          route: unresolved
            ? "Unresolved route"
            : row.viaCdsId !== null
              ? "Boundary via CDS"
              : from === to
                ? "Local"
                : "Boundary, no CDS recorded",
          cds: name(cds, row.viaCdsId),
          cdsId: reference("cds", row.viaCdsId),
        };
      }),
    };
    if (full) {
      tables["Scenarios"] = data.scenarios.map(({ id, name, description }) => ({
        id: lookup("scenario", id),
        name,
        description,
      }));
      tables["Scenario changes"] = data.scenarioChanges.map((change) => {
        const serviceId = "serviceId" in change ? lookup("service", change.serviceId) : null;
        return {
          id: lookup("scenario_change", change.id),
          scenarioId: lookup("scenario", change.scenarioId),
          kind: change.kind,
          serviceId,
          networkId: "networkId" in change ? lookup("network", change.networkId) : null,
          providerId: "providerOrgId" in change ? reference("organization", change.providerOrgId) : null,
          targetServiceId: change.kind === "merge" ? reference("service", change.intoServiceId) : null,
          targetChangeId: change.kind === "merge" ? reference("scenario_change", change.intoChangeId) : null,
          name: "name" in change ? change.name : null,
          description: "description" in change ? change.description : null,
          marking: "marking" in change ? change.marking : null,
        };
      });
    }
    if (includeNotes) {
      const visibleIds = new Map<string, string>();
      for (const table of ["Services", "Service dependencies", "Consuming organizations"]) {
        for (const row of tables[table] ?? []) {
          if (typeof row["id"] !== "string") continue;
          const label =
            table === "Services"
              ? `${String(row["service"])} (${String(row["network"])})`
              : table === "Service dependencies"
                ? `${String(row["consumer"])} → ${String(row["provider"])}`
                : `${String(row["organization"])} consumes ${String(row["service"])}`;
          visibleIds.set(row["id"], label);
        }
      }
      tables["Assessment evidence and questions"] = notes
        .filter((note) => full || (note.target.id !== null && !note.detached && visibleIds.has(note.target.id)))
        .map((note) => ({
          type: note.kind,
          target: full ? note.target.label : (visibleIds.get(note.target.id ?? "") ?? "Included assertion"),
          aspect: note.aspect,
          state: note.currentState,
          details: note.text,
          sourceOrNextAction: note.source || null,
          responsible: note.responsible || null,
          checkedOn: note.checkedOn || null,
          basis: note.kind === "Evidence" ? note.basis : null,
          finding: note.kind === "Evidence" ? note.finding : null,
          resolution: note.resolution || null,
          marking: note.marking,
          detached: note.detached,
        }));
    }
    if (Object.values(tables).reduce((count, rows) => count + rows.length, 0) > MAX_ROWS) {
      throw new Error("This export has too many rows. Filter the map to a smaller scope and try again.");
    }
    return { view, tables, totals: { services: data.services.length, dependencies: data.dependencies.length } };
  }
  const inventories = [inventory(snapshot, "As-Is")];
  if (mapView && mapView.view.kind !== "as-is") {
    const { scenarioId, kind } = mapView.view;
    const scenario = snapshot.scenarios.find(({ id }) => id === scenarioId);
    if (!scenario) throw new Error("The selected scenario is unavailable.");
    const proposal = inventory(applyScenario(snapshot, scenarioId), `To-Be: ${scenario.name}`);
    if (kind === "compare") inventories.push(proposal);
    else inventories.splice(0, 1, proposal);
  }
  const { lineage, description, scope, exclusions, assessor, startedOn, asOf } = context;
  return {
    ...source,
    format: "sim-assessment/v1",
    dataset: repo.datasetName(),
    lineage,
    scope: mapView ? "current map scope" : "all recorded inventory",
    marking: snapshot.marking,
    caveat: snapshot.caveat,
    details: mapView ? null : { description, scope, exclusions, assessor, startedOn, asOf },
    inventories,
    map: mapView?.svg ?? null,
  };
}

export type OutputFormat = "html" | "json" | "csv";

const htmlText = (value: Cell): string =>
  value === null
    ? "Not recorded"
    : String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

const codeColumns = new Set([
  "id",
  "networkId",
  "providerId",
  "consumerId",
  "applicationId",
  "categoryId",
  "serviceId",
  "organizationId",
  "parentId",
  "cdsId",
  "scenarioId",
  "targetServiceId",
  "targetChangeId",
]);

function renderHtml(output: AssessmentOutput, checkpoint: string): string {
  const title = htmlText(output.dataset);
  const marking = htmlText(bannerText(output.marking, output.caveat));
  const details = output.details;
  const context = details
    ? `<dl><dt>Scope</dt><dd>${details.scope ? htmlText(details.scope) : "Scope not recorded"}</dd><dt>Exclusions</dt><dd>${htmlText(details.exclusions)}</dd><dt>Description</dt><dd>${htmlText(details.description)}</dd><dt>Assessor or team</dt><dd>${htmlText(details.assessor)}</dd><dt>Period start</dt><dd>${htmlText(details.startedOn)}</dd><dt>As of</dt><dd>${htmlText(details.asOf)}</dd></dl>`
    : "<p>Assessment-level details were omitted from this focused export.</p>";
  const map =
    output.map === null
      ? ""
      : `<figure><img alt="Map of the exported scope. Recorded services and dependencies are listed below." src="data:image/svg+xml,${encodeURIComponent(output.map)}"><figcaption>Map captured at export time.</figcaption></figure>`;
  const sections = output.inventories
    .map((section) => {
      const tables = Object.entries(section.tables)
        .map(([label, rows]) => {
          const columns = Object.keys(rows[0] ?? {}).filter((column) => !codeColumns.has(column));
          const head = columns.map((column) => `<th scope="col">${htmlText(column)}</th>`).join("");
          const contents = rows
            .map((row) => `<tr>${columns.map((column) => `<td>${htmlText(row[column] ?? null)}</td>`).join("")}</tr>`)
            .join("");
          return rows.length === 0
            ? ""
            : `<table><caption>${htmlText(label)} (${String(rows.length)})</caption><thead><tr>${head}</tr></thead><tbody>${contents}</tbody></table>`;
        })
        .join("");
      return `<section><h2>${htmlText(section.view)}</h2><p>${String(section.tables["Services"]?.length ?? 0)} of ${String(section.totals.services)} recorded services and ${String(section.tables["Service dependencies"]?.length ?? 0)} of ${String(section.totals.dependencies)} recorded service dependencies in this projection.</p>${tables}</section>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:1rem system-ui,sans-serif;color:#182236;margin:0 auto;max-width:90rem;padding:1rem}header,footer{font-weight:700;text-align:center;background:#eef3f9;padding:.5rem}img{display:block;max-width:100%;max-height:82vh;margin:auto}figure{margin:1rem 0}table{border-collapse:collapse;width:100%;margin:1rem 0 2rem;table-layout:fixed}caption{text-align:left;font-weight:700;margin:.4rem 0}th,td{border:1px solid #a0aec0;vertical-align:top;text-align:left;padding:.4rem;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#eff3f9}dd,p,small{overflow-wrap:anywhere}dd{white-space:pre-wrap}@media print{body{padding:0;font-size:9pt}tr{break-inside:avoid}thead{display:table-header-group}img{max-height:60vh}h2,caption{break-after:avoid}}</style>
<header>${marking}</header><main><h1>${title}</h1><p>Assessment generated ${htmlText(output.generated)} from ${htmlText(output.scope)}. File state at export: ${htmlText(output.fileState)}.</p>${context}
<p>Dependencies point from consumers to providers. Connectivity is unverified. Counts cover recorded relationships in the stated scope. Hiding records does not reduce the source marking. Unrelated records outside the selected scope were omitted.</p>${map}${sections}<p>Data format ${String(output.schema)}. SIM ${htmlText(output.build.version)} build ${htmlText(output.build.commit)}. Source checkpoint ${htmlText(checkpoint)}.</p></main><footer>${marking}</footer></html>`;
}

export function renderAssessment(output: AssessmentOutput, format: OutputFormat, checkpoint: string): Blob {
  if (format === "html") return bounded(renderHtml(output, checkpoint), "text/html;charset=utf-8");
  const data = { ...output, map: undefined };
  const inventories = data.inventories.map((section) => ({
    ...section,
    rowCounts: Object.fromEntries(Object.entries(section.tables).map(([name, rows]) => [name, rows.length])),
  }));
  if (format === "json")
    return bounded(JSON.stringify({ ...data, checkpoint, inventories }, null, 2), "application/json");
  const rows: string[][] = [
    ["Marking", bannerText(output.marking, output.caveat)],
    ["Dataset", output.dataset],
    ["Scope", output.scope],
    ["Generated", output.generated],
    ["Checkpoint", checkpoint],
    ["Format", output.format],
    ["Build", output.build.commit],
    ["Dataset schema", String(output.schema)],
    ["Lineage", output.lineage],
    ["File state", output.fileState],
    ["Display CSV", "Formula-like cells are prefixed with an apostrophe. Download typed JSON for exact values."],
  ];
  for (const section of inventories) {
    rows.push([], ["Projection", section.view]);
    for (const [name, records] of Object.entries(section.tables)) {
      rows.push([], [name, String(records.length)]);
      const columns = Object.keys(records[0] ?? {});
      if (columns.length === 0) continue;
      rows.push(columns);
      for (const row of records) rows.push(columns.map((column) => String(row[column] ?? "")));
    }
  }
  return bounded(toCsv(rows.map((row) => row.map(spreadsheetText))), "text/csv;charset=utf-8");
}

function bounded(text: string, type: string): Blob {
  const blob = new Blob([text], { type });
  if (blob.size > MAX_OUTPUT_BYTES) throw new Error("This export is larger than 25 MB. Choose a smaller map scope.");
  return blob;
}
