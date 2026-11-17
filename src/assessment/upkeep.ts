import type { Repository } from "../domain/repository";
import type { Tier } from "../domain/types";

export type Assignment = "provider" | "category" | "support";
export interface AssignmentTarget {
  readonly id: string;
  readonly label: string;
}

export interface BatchPlan {
  readonly field: Assignment;
  readonly tier: Tier;
  readonly to: number;
  readonly changes: readonly {
    readonly id: number;
    readonly identity: string;
    readonly label: string;
    readonly before: number | null;
    readonly beforeLabel: string;
    readonly notes: string | null;
  }[];
  readonly targetIdentity: string;
  readonly targetLabel: string;
}

export function previewBatch(
  repo: Repository,
  selected: readonly AssignmentTarget[],
  field: Assignment,
  tier: Tier,
  to: number,
): BatchPlan {
  if (
    selected.length === 0 ||
    selected.length > 200 ||
    new Set(selected.map(({ id }) => id)).size !== selected.length
  ) {
    throw new Error("Select between 1 and 200 distinct services for a batch.");
  }
  const table = field === "category" ? "category" : "organization";
  const target = field === "category" ? repo.getCategory(to) : repo.getOrganization(to);
  const targetIdentity = repo.exchangeIdentities(table).get(String(to));
  if (!target || !targetIdentity) throw new Error("The chosen assignment is unavailable.");
  const ids = repo.exchangeIdentities("service");
  const serviceIds = new Map([...ids].map(([id, identity]) => [identity, Number(id)]));
  const changes = selected.map(({ id: identity, label }) => {
    const id = serviceIds.get(identity);
    const service = id === undefined ? undefined : repo.getService(id);
    if (id === undefined || !service) throw new Error(`${label} is no longer available.`);
    const support = field === "support" ? repo.listSupport(id).find((row) => row.tier === tier) : undefined;
    const before =
      field === "provider"
        ? service.providerOrgId
        : field === "category"
          ? service.categoryId
          : (support?.orgId ?? null);
    const reference =
      before === null ? null : field === "category" ? repo.getCategory(before) : repo.getOrganization(before);
    return {
      id,
      identity,
      label,
      before,
      beforeLabel: reference?.name ?? "Not recorded",
      notes: support?.notes ?? null,
    };
  });
  return { field, tier, to, changes, targetIdentity, targetLabel: target.name };
}

export function applyBatch(repo: Repository, plan: BatchPlan): number {
  return repo.atomic(() => {
    const current = previewBatch(
      repo,
      plan.changes.map(({ identity, label }) => ({ id: identity, label })),
      plan.field,
      plan.tier,
      plan.to,
    );
    if (current.targetIdentity !== plan.targetIdentity || current.targetLabel !== plan.targetLabel) {
      throw new Error("The shared assignment changed. Preview the batch again.");
    }
    for (const [index, row] of current.changes.entries()) {
      const before = plan.changes[index];
      if (before?.before !== row.before || before.beforeLabel !== row.beforeLabel || before.notes !== row.notes) {
        throw new Error(`${row.label} changed after preview. Review it and preview the batch again.`);
      }
    }
    const changes = plan.changes.filter((row) => row.before !== plan.to);
    for (const row of changes) repo.assignServiceReference(row.id, plan.field, plan.to, plan.tier);
    return changes.length;
  });
}

export function duplicateSuggestions(repo: Repository) {
  const snapshot = repo.snapshot();
  const records = [
    ...snapshot.organizations.map((row) => ({ ...row, type: "organization" as const })),
    ...snapshot.applications.map((row) => ({ ...row, type: "application" as const })),
  ];
  const groups = new Map<string, typeof records>();
  for (const record of records) {
    const canonical = record.name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
    if (!canonical) continue;
    const key = `${record.type}:${canonical}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const counts = new Map<string, number>();
  const count = (type: string, id: number | null): void => {
    const key = `${type}:${String(id)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const service of snapshot.services) {
    count("organization", service.providerOrgId);
    count("application", service.applicationId);
  }
  for (const row of snapshot.support) count("organization", row.orgId);
  for (const row of snapshot.consumption) count("organization", row.orgId);
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) =>
      group.map((record) => ({ ...record, uses: counts.get(`${record.type}:${String(record.id)}`) ?? 0 })),
    );
}
