import { CsvError, type CsvRow } from "./csv";

/**
 * One CSV template per entity and relationship (WORK-011). A file's header must hold exactly one
 * template's columns, in any order, so a misspelled or missing column is refused instead of quietly
 * dropping data. Rows refer to other records by name; a service is named with its network, since
 * service names repeat across networks.
 */
export type TemplateType =
  | "networks"
  | "organizations"
  | "categories"
  | "applications"
  | "services"
  | "cds"
  | "support"
  | "consumers"
  | "dependencies";

export interface Template {
  readonly type: TemplateType;
  readonly title: string;
  readonly columns: readonly string[];
  /** A fictional example row for the downloadable template. */
  readonly example: readonly string[];
}

export const TEMPLATES: readonly Template[] = [
  {
    type: "networks",
    title: "Networks",
    columns: ["name", "kind", "marking", "description"],
    example: ["Enterprise", "internal", "UNCLASSIFIED", "Day-to-day business network"],
  },
  {
    type: "organizations",
    title: "Organizations",
    columns: ["name", "parent"],
    example: ["Help Desk", "IT Directorate"],
  },
  { type: "categories", title: "Categories", columns: ["name", "color"], example: ["Collaboration", "#2457a6"] },
  {
    type: "applications",
    title: "Applications",
    columns: ["name", "vendor", "description"],
    example: ["Mail Platform", "Example Vendor", ""],
  },
  {
    type: "services",
    title: "Services",
    columns: ["name", "network", "marking", "application", "category", "provider", "foundational", "description"],
    example: ["Email", "Enterprise", "UNCLASSIFIED", "Mail Platform", "Collaboration", "IT Directorate", "no", ""],
  },
  {
    type: "cds",
    title: "Cross-domain solutions",
    columns: ["name", "networks", "description"],
    example: ["Enterprise-Ops guard", "Enterprise; Operations", ""],
  },
  {
    type: "support",
    title: "Support tiers",
    columns: ["service", "network", "tier", "organization", "notes"],
    example: ["Email", "Enterprise", "1", "Help Desk", ""],
  },
  {
    type: "consumers",
    title: "Consuming organizations",
    columns: ["organization", "service", "network"],
    example: ["Planners", "Email", "Enterprise"],
  },
  {
    type: "dependencies",
    title: "Service dependencies",
    columns: ["consumer", "consumer_network", "provider", "provider_network", "via_cds"],
    example: ["Email", "Operations", "Email", "Enterprise", "Enterprise-Ops guard"],
  },
];

/** Import order: what a row refers to is created first, whatever order the files were chosen in. */
export const IMPORT_ORDER: readonly TemplateType[] = TEMPLATES.map((t) => t.type);

const normalize = (header: string) => header.trim().toLowerCase().replace(/\s+/g, "_");

export interface TemplateRow {
  readonly row: number;
  readonly values: Readonly<Record<string, string>>;
  /** The row has values beyond the header's columns (often a stray comma in a name). */
  readonly overflow: boolean;
}

export interface TemplateFile {
  readonly name: string;
  readonly template: Template;
  readonly rows: readonly TemplateRow[];
}

/** Match a parsed file to its template by its header, and key each row's values by column. */
export function readTemplate(name: string, rows: readonly CsvRow[]): TemplateFile {
  const [header, ...body] = rows;
  if (!header) throw new CsvError("The file is empty.");
  const columns = header.fields.map(normalize);
  const seen = new Set<string>();
  for (const c of columns) {
    if (seen.has(c)) throw new CsvError(`The column "${c}" appears twice.`, header.row);
    seen.add(c);
  }
  const template = TEMPLATES.find((t) => t.columns.length === columns.length && t.columns.every((c) => seen.has(c)));
  if (!template) {
    const closest = [...TEMPLATES].sort(
      (a, b) => b.columns.filter((c) => seen.has(c)).length - a.columns.filter((c) => seen.has(c)).length,
    )[0];
    const expected = closest?.columns ?? [];
    const unknown = columns.filter((c) => !expected.includes(c));
    const missing = expected.filter((c) => !seen.has(c));
    const parts = [
      unknown.length > 0 ? `unknown column ${unknown.map((c) => `"${c}"`).join(", ")}` : "",
      missing.length > 0 ? `missing ${missing.map((c) => `"${c}"`).join(", ")}` : "",
    ].filter(Boolean);
    throw new CsvError(
      `The header matches no template (${parts.join("; ")}). The ${closest?.title ?? ""} template has: ${expected.join(", ")}.`,
      header.row,
    );
  }
  return {
    name,
    template,
    rows: body.map((r) => ({
      row: r.row,
      // Keep cell bytes for references to readable legacy names with surrounding spaces.
      // Each authoring validator still normalizes newly created values.
      values: Object.fromEntries(columns.map((c, i) => [c, r.fields[i] ?? ""])),
      overflow: r.fields.slice(columns.length).some((f) => f.trim() !== ""),
    })),
  };
}
