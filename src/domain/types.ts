import type { Marking } from "../db/markings";

export type NetworkKind = "internal" | "external";
export type Tier = 1 | 2 | 3;

export interface Network {
  readonly id: number;
  readonly name: string;
  readonly kind: NetworkKind;
  readonly marking: Marking;
  readonly description: string | null;
}

export interface Organization {
  readonly id: number;
  readonly name: string;
  readonly parentId: number | null;
}

export interface Category {
  readonly id: number;
  readonly name: string;
  readonly color: string | null;
}

export interface Application {
  readonly id: number;
  readonly name: string;
  readonly vendor: string | null;
  readonly description: string | null;
}

export interface Service {
  readonly id: number;
  readonly name: string;
  readonly networkId: number;
  readonly applicationId: number | null;
  readonly categoryId: number | null;
  readonly providerOrgId: number | null;
  readonly marking: Marking;
  readonly foundational: boolean;
  readonly description: string | null;
}

export interface Cds {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly networkIds: readonly number[];
}

export interface SupportAssignment {
  readonly serviceId: number;
  readonly tier: Tier;
  readonly orgId: number;
  readonly notes: string | null;
}

export interface Consumption {
  readonly orgId: number;
  readonly serviceId: number;
}

export interface Dependency {
  readonly consumerServiceId: number;
  readonly providerServiceId: number;
  readonly viaCdsId: number | null;
}

// Inputs: create and update both take the full record (update replaces every field).
export interface NetworkInput {
  name: string;
  kind: NetworkKind;
  marking: Marking;
  description?: string | null;
}

export interface OrganizationInput {
  name: string;
  parentId?: number | null;
}

export interface CategoryInput {
  name: string;
  color?: string | null;
}

export interface ApplicationInput {
  name: string;
  vendor?: string | null;
  description?: string | null;
}

export interface ServiceInput {
  name: string;
  networkId: number;
  marking: Marking;
  applicationId?: number | null;
  categoryId?: number | null;
  providerOrgId?: number | null;
  foundational?: boolean;
  description?: string | null;
}

export interface CdsInput {
  name: string;
  networkIds: readonly number[];
  description?: string | null;
}

export interface DependencyInput {
  consumerServiceId: number;
  providerServiceId: number;
  viaCdsId?: number | null;
}

export interface WriteOptions {
  /** The user confirmed saving text that looks like an IP address or host name (Q-032). */
  readonly confirmSensitive?: boolean;
}

/** Where a node sits on the map, in model coordinates (decomposition Q-022). */
export interface NodePosition {
  readonly entity: "network" | "service" | "cds";
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** Read-only view of the whole dataset for the map; never written back. */
export interface Snapshot {
  readonly marking: Marking;
  /** Banner caveat appended after the marking, or null. */
  readonly caveat: string | null;
  readonly networks: readonly Network[];
  readonly services: readonly Service[];
  readonly cds: readonly (Cds & { readonly marking: Marking })[];
  readonly organizations: readonly Organization[];
  readonly applications: readonly Application[];
  readonly categories: readonly Category[];
  readonly support: readonly SupportAssignment[];
  readonly consumption: readonly Consumption[];
  readonly dependencies: readonly Dependency[];
  /** Saved map positions; a node without one has not been placed yet. */
  readonly positions: readonly NodePosition[];
}
