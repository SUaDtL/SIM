import type { Repository } from "../domain/repository";
import type { NoteTarget } from "./notes";

export type ResolvedNoteTarget =
  | { kind: "assessment" }
  | { kind: "service"; serviceId: number }
  | { kind: "service_dependency"; consumerServiceId: number; providerServiceId: number; viaCdsId: number | null }
  | { kind: "org_consumes"; orgId: number; serviceId: number };

/** Re-resolve the persisted assertion, including the identity of the relationship itself. */
export function resolveNoteTarget(repo: Repository, target: NoteTarget): ResolvedNoteTarget | null {
  if (target.kind === "assessment") return target.id === null ? { kind: "assessment" } : null;
  const table = target.kind;
  const ids = repo.exchangeIdentities(table);
  const key = [...ids].find(([, identity]) => identity === target.id)?.[0];
  if (key === undefined) return null;
  if (table === "service") return { kind: "service", serviceId: Number(key) };
  const [first, second] = key.split(":").map(Number);
  if (first === undefined || second === undefined) return null;
  if (table === "org_consumes") return { kind: table, orgId: first, serviceId: second };
  const dependency = repo
    .listDependencies()
    .find((row) => row.consumerServiceId === first && row.providerServiceId === second);
  return dependency ? { kind: table, ...dependency } : null;
}
