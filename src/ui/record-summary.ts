import type { Repository } from "../domain/repository";
import type { Dependency, Snapshot } from "../domain/types";
import { button, el } from "./dom";
import type { EntityType } from "./forms";
import { relatedEntities, type EntityTarget } from "./relations";
import {
  captureRelationshipCollectionView,
  createRelationshipCollection,
  restoreRelationshipCollectionView,
  type RelationshipCollectionViewContext,
  type RelationshipRow,
} from "./relationship-collection";

export type SummarySection = "overview" | "connections" | "support";

export interface RecordSummaryViewContext {
  readonly section: SummarySection;
  readonly collections: Readonly<Record<string, RelationshipCollectionViewContext>>;
  readonly scrollTop: number;
}

interface SummaryController {
  capture(): RecordSummaryViewContext;
  restore(view: RecordSummaryViewContext, focus: boolean): void;
}

const controllers = new WeakMap<HTMLElement, SummaryController>();

export function captureRecordSummaryView(element: HTMLElement): RecordSummaryViewContext | undefined {
  return controllers.get(element)?.capture();
}

/** Restore after insertion when scroll offsets or the originating control must be restored. */
export function restoreRecordSummaryView(
  element: HTMLElement,
  view: RecordSummaryViewContext,
  options: { readonly focus?: boolean } = {},
): void {
  controllers.get(element)?.restore(view, options.focus ?? false);
}

export interface SummaryField {
  readonly label: string;
  readonly value: string;
  readonly target?: EntityTarget;
}

export interface SummaryGroup {
  readonly title: string;
  readonly rows: readonly RelationshipRow[];
  readonly section: SummarySection;
  readonly emptyText: string;
  readonly filterRoles?: boolean;
}

export interface RecordSummaryModel {
  readonly title: string;
  readonly context: string;
  readonly fields: readonly SummaryField[];
  readonly groups: readonly SummaryGroup[];
  readonly editScope: string | null;
}

const labels: Record<EntityType, string> = {
  service: "Service",
  network: "Network",
  organization: "Organization",
  application: "Application",
  category: "Category",
  cds: "CDS",
  scenario: "Scenario",
};

/** Baseline presenter. Projected inspection must use its origin-aware, read-only presenter. */
export function recordSummaryModel(snapshot: Snapshot, target: EntityTarget): RecordSummaryModel | null {
  if ("projection" in snapshot) return null;
  const records = {
    service: snapshot.services,
    network: snapshot.networks,
    organization: snapshot.organizations,
    application: snapshot.applications,
    category: snapshot.categories,
    cds: snapshot.cds,
    scenario: snapshot.scenarios,
  };
  const record = records[target.type].find((item) => item.id === target.id);
  if (!record) return null;
  const networkNames = new Map(snapshot.networks.map((item) => [item.id, item.name]));
  const qualified = (type: EntityType, id: number): string => {
    const item = records[type].find((candidate) => candidate.id === id);
    if (!item) return `Missing ${labels[type].toLowerCase()} #${String(id)}`;
    if (type === "service") {
      const service = snapshot.services.find((candidate) => candidate.id === id);
      return `${item.name} (${networkNames.get(service?.networkId ?? Number.NaN) ?? "Missing network"})`;
    }
    return item.name;
  };
  const ref = (label: string, type: EntityType, id: number | null): SummaryField => {
    if (id === null) return { label, value: "Not assigned" };
    const value = qualified(type, id);
    return records[type].some((item) => item.id === id) ? { label, value, target: { type, id } } : { label, value };
  };
  const route = (dependency: Dependency): string =>
    dependency.viaCdsId === null
      ? "No CDS recorded. Connectivity is not verified."
      : `Via CDS: ${qualified("cds", dependency.viaCdsId)}`;
  // Retain unavailable service references as text, using this presenter's established route wording.
  const related = relatedEntities(snapshot, target, {
    includeMissing: target.type === "service",
    dependencyDetail: (dependency) =>
      target.type === "service"
        ? route(dependency)
        : `${qualified("service", dependency.consumerServiceId)} → ${qualified("service", dependency.providerServiceId)} · ${dependency.viaCdsId === null ? "No CDS recorded" : `CDS: ${qualified("cds", dependency.viaCdsId)}`}`,
  });
  const row = (
    type: EntityType,
    id: number,
    role: string,
    detail: string,
    key: string,
    connection?: RelationshipRow["connection"],
  ): RelationshipRow => ({
    key,
    label: qualified(type, id),
    role,
    detail,
    ...(records[type].some((item) => item.id === id) ? { target: { type, id } } : {}),
    ...(connection ? { connection } : {}),
  });
  const fields: SummaryField[] = [];
  const groups: SummaryGroup[] = [];
  let context = "As-Is record";
  let editScope: string | null = null;
  switch (target.type) {
    case "service": {
      const service = snapshot.services.find((item) => item.id === target.id);
      if (!service) return null;
      context = `As-Is · ${networkNames.get(service.networkId) ?? "Missing network"} · ${service.marking}`;
      fields.push(
        ref("Network", "network", service.networkId),
        { label: "Classification", value: service.marking },
        ref("Provided by", "organization", service.providerOrgId),
        ref("Application", "application", service.applicationId),
        ref("Category", "category", service.categoryId),
        { label: "Foundational", value: service.foundational ? "Foundational service" : "Not foundational" },
        { label: "Description", value: service.description ?? "No description recorded." },
      );
      const dependencies = (incoming: boolean): RelationshipRow[] =>
        related.flatMap((item) => {
          const dependency = item.dependency;
          if (!dependency || item.label !== (incoming ? "Used by services" : "Depends on")) return [];
          return [
            row(
              "service",
              item.target.id,
              item.label,
              item.detail,
              `${String(dependency.consumerServiceId)}:${String(dependency.providerServiceId)}`,
              { consumer: dependency.consumerServiceId, provider: dependency.providerServiceId },
            ),
          ];
        });
      groups.push(
        {
          title: "Depends on",
          section: "connections",
          rows: dependencies(false),
          emptyText: "No outgoing dependencies recorded.",
        },
        {
          title: "Used by services",
          section: "connections",
          rows: dependencies(true),
          emptyText: "No incoming service dependencies recorded.",
        },
        {
          title: "Consumed by organizations",
          section: "connections",
          rows: related
            .filter((item) => item.label === "Consumed by organizations")
            .map((item) =>
              row(
                "organization",
                item.target.id,
                "Consumed by organizations",
                "Recorded organizational consumption",
                `consumer:${String(item.target.id)}`,
              ),
            ),
          emptyText: "No consuming organizations recorded.",
        },
        {
          title: "Support assignments",
          section: "support",
          rows: snapshot.support
            .filter((item) => item.serviceId === service.id)
            .map((item) =>
              row(
                "organization",
                item.orgId,
                `Tier ${String(item.tier)}`,
                `Tier ${String(item.tier)}${item.notes ? ` · ${item.notes}` : " · No notes recorded"}`,
                `support:${String(item.tier)}`,
              ),
            ),
          emptyText: "No support organizations assigned.",
        },
      );
      break;
    }
    case "network": {
      const network = snapshot.networks.find((item) => item.id === target.id);
      if (!network) return null;
      fields.push(
        {
          label: "Kind",
          value: network.kind === "external" ? "External network (SaaS or third party)" : "Internal network",
        },
        { label: "Classification", value: network.marking },
        { label: "Description", value: network.description ?? "No description recorded." },
      );
      break;
    }
    case "organization": {
      const organization = snapshot.organizations.find((item) => item.id === target.id);
      if (!organization) return null;
      fields.push(
        organization.parentId === null
          ? { label: "Part of", value: "Top-level organization" }
          : ref("Part of", "organization", organization.parentId),
      );
      editScope =
        "This is a shared organization. Editing its name changes how it appears on every recorded assignment. Changing one service's assignment does not rename this organization.";
      break;
    }
    case "application": {
      const application = snapshot.applications.find((item) => item.id === target.id);
      if (!application) return null;
      fields.push(
        { label: "Vendor", value: application.vendor ?? "Not recorded" },
        { label: "Description", value: application.description ?? "No description recorded." },
      );
      editScope = "This is a shared application. Editing it updates the record referenced by every assigned service.";
      break;
    }
    case "category": {
      const category = snapshot.categories.find((item) => item.id === target.id);
      if (!category) return null;
      fields.push({ label: "Color", value: category.color ?? "Default color" });
      editScope = "This is a shared category. Editing it updates the record referenced by every assigned service.";
      break;
    }
    case "cds": {
      const cds = snapshot.cds.find((item) => item.id === target.id);
      if (!cds) return null;
      fields.push(
        { label: "Classification", value: cds.marking },
        { label: "Description", value: cds.description ?? "No description recorded." },
      );
      break;
    }
    case "scenario": {
      const scenario = snapshot.scenarios.find((item) => item.id === target.id);
      if (!scenario) return null;
      context = "Scenario definition over As-Is data";
      fields.push(
        { label: "Description", value: scenario.description ?? "No description recorded." },
        {
          label: "Planned changes",
          value: String(snapshot.scenarioChanges.filter((item) => item.scenarioId === target.id).length),
        },
      );
      break;
    }
  }
  if (target.type !== "service") {
    const relationships = related.filter((item) => item.label !== "Part of");
    if (target.type === "organization") {
      const serviceRoles = relationships.filter((item) => item.target.type === "service");
      groups.push({
        title: "Service relationships",
        section: "connections",
        filterRoles: true,
        rows: serviceRoles.map((item) =>
          row(
            item.target.type,
            item.target.id,
            item.label,
            `${item.label} · ${item.detail}`,
            `${item.target.type}:${String(item.target.id)}:${item.label}`,
          ),
        ),
        emptyText: "No providing, support or consumption assignments recorded.",
      });
    }
    const remaining =
      target.type === "organization" ? relationships.filter((item) => item.target.type !== "service") : relationships;
    for (const title of new Set(remaining.map((item) => item.label))) {
      groups.push({
        title,
        section: "connections",
        rows: remaining
          .filter((item) => item.label === title)
          .map((item) => {
            const dependency = item.dependency;
            return row(
              item.target.type,
              item.target.id,
              item.label,
              item.detail,
              dependency
                ? `dependency:${String(dependency.consumerServiceId)}:${String(dependency.providerServiceId)}`
                : `${item.target.type}:${String(item.target.id)}:${title}`,
              dependency
                ? { consumer: dependency.consumerServiceId, provider: dependency.providerServiceId }
                : undefined,
            );
          }),
        emptyText: "No relationships recorded.",
      });
    }
  }
  return { title: `${labels[target.type]}: ${record.name}`, context, fields, groups, editScope };
}

export interface RecordSummaryOptions {
  readonly repo: Repository;
  readonly target: EntityTarget;
  readonly onNavigate: (target: EntityTarget) => void;
  readonly onEdit?: (section?: SummarySection) => void;
  readonly onDependency?: (consumer: number, provider: number) => void;
  readonly onSimilar?: () => void;
  readonly onDelete?: () => void;
  readonly initialSection?: SummarySection;
  readonly initialView?: RecordSummaryViewContext;
}

let sequence = 0;

export function createRecordSummary(ctx: RecordSummaryOptions): HTMLElement {
  const model = recordSummaryModel(ctx.repo.snapshot(), ctx.target);
  if (!model)
    return el(
      "section",
      { class: "record-summary" },
      el("h2", { tabindex: "-1" }, "Record unavailable"),
      el("p", {}, "This record no longer exists. Choose another record."),
    );
  let section: SummarySection = ctx.initialView?.section ?? ctx.initialSection ?? "overview";
  const element = el("section", { class: "record-summary", "data-testid": "record-summary" });
  const collections = new Map<string, HTMLElement>();
  let chooseSection = (next: SummarySection): void => {
    section = next;
  };
  controllers.set(element, {
    capture: () => ({
      section,
      scrollTop: element.scrollTop,
      collections: Object.fromEntries(
        [...collections].flatMap(([key, collection]) => {
          const view = captureRelationshipCollectionView(collection);
          return view ? [[key, view]] : [];
        }),
      ),
    }),
    restore: (view, focus) => {
      chooseSection(view.section);
      for (const [key, collection] of collections) {
        const context = view.collections[key];
        if (context) restoreRelationshipCollectionView(collection, context, focus);
      }
      element.scrollTop = view.scrollTop;
    },
  });
  const overview = el(
    "dl",
    { class: "summary-fields" },
    ...model.fields.flatMap((field) => [
      el("dt", {}, field.label),
      el(
        "dd",
        {},
        field.target
          ? button(
              field.value,
              () => {
                if (field.target) ctx.onNavigate(field.target);
              },
              {
                class: "record-link",
                "data-summary-reference": `${field.target.type}:${String(field.target.id)}:${field.label}`,
              },
            )
          : field.value,
      ),
    ]),
  );
  const actions = el("div", { class: "record-summary-actions" });
  if (ctx.onEdit)
    actions.append(
      button(
        "Edit",
        () => {
          ctx.onEdit?.(section);
        },
        { class: "primary", "data-summary-action": "edit", "aria-label": `Edit ${ctx.target.type}` },
      ),
    );
  if (ctx.onSimilar || ctx.onDelete) {
    const more = el(
      "details",
      { class: "record-secondary-actions" },
      el("summary", {}, ctx.target.type === "service" ? "More service actions" : "More record actions"),
    );
    if (ctx.onSimilar) more.append(button("Create similar service", ctx.onSimilar));
    if (ctx.onDelete) more.append(button("Delete record", ctx.onDelete, { class: "danger" }));
    actions.append(more);
  }
  element.append(
    el(
      "header",
      { class: "record-summary-heading" },
      el("h2", { tabindex: "-1" }, model.title),
      el("p", { class: "record-context" }, model.context),
      actions,
    ),
  );
  if (model.editScope) element.append(el("p", { class: "shared-scope" }, model.editScope));
  const groups = (name: SummarySection): HTMLElement[] =>
    model.groups
      .filter((group) => group.section === name)
      .map((group) => {
        const initialView = ctx.initialView?.collections[group.title];
        const collection = createRelationshipCollection({
          ...group,
          onNavigate: ctx.onNavigate,
          ...(ctx.onDependency ? { onDependency: ctx.onDependency } : {}),
          ...(initialView ? { initialView } : {}),
        });
        collections.set(group.title, collection);
        return collection;
      });
  if (ctx.target.type !== "service") {
    element.append(overview, ...groups("connections"));
    if (model.groups.length === 0) element.append(el("p", { class: "empty" }, "No related records recorded."));
    return element;
  }
  const prefix = `record-summary-${String(++sequence)}`;
  const names: readonly [SummarySection, string][] = [
    ["overview", "Overview"],
    ["connections", "Connections"],
    ["support", "Support"],
  ];
  const tabs = el("div", { class: "summary-tabs", role: "tablist", "aria-label": "Service inspection sections" });
  const panels = new Map<SummarySection, HTMLElement>();
  const buttons = new Map<SummarySection, HTMLButtonElement>();
  const choose = (next: SummarySection, focus = false): void => {
    section = next;
    element.dataset["summarySection"] = section;
    for (const [name, tab] of buttons) {
      tab.setAttribute("aria-selected", String(name === section));
      tab.tabIndex = name === section ? 0 : -1;
      const panel = panels.get(name);
      if (panel) panel.hidden = name !== section;
    }
    if (focus) buttons.get(section)?.focus();
  };
  chooseSection = choose;
  for (const [name, label] of names) {
    const tab = button(
      label,
      () => {
        choose(name);
      },
      {
        role: "tab",
        id: `${prefix}-${name}-tab`,
        "aria-controls": `${prefix}-${name}-panel`,
        "data-summary-tab": name,
      },
    );
    const panel = el("section", {
      class: "summary-panel",
      role: "tabpanel",
      id: `${prefix}-${name}-panel`,
      "aria-labelledby": tab.id,
    });
    if (name === "overview") panel.append(overview);
    else panel.append(...groups(name));
    buttons.set(name, tab);
    panels.set(name, panel);
    tabs.append(tab);
  }
  tabs.addEventListener("keydown", (event) => {
    const index = names.findIndex(([name]) => buttons.get(name) === document.activeElement);
    if (index < 0) return;
    const move =
      event.key === "ArrowRight"
        ? (index + 1) % names.length
        : event.key === "ArrowLeft"
          ? (index + names.length - 1) % names.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? names.length - 1
              : null;
    if (move === null) return;
    event.preventDefault();
    const next = names[move];
    if (next) choose(next[0], true);
  });
  element.append(tabs, ...panels.values());
  choose(section);
  return element;
}
