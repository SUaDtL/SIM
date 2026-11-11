export type ValidationCode =
  | "REQUIRED"
  | "TOO_LONG"
  | "INVALID_VALUE"
  | "DUPLICATE"
  | "IN_USE"
  | "NOT_FOUND"
  | "CYCLE"
  | "CDS_NETWORKS"
  | "CDS_ROUTE"
  | "SELF_LINK";

/** A write was refused; nothing was changed. `field` names what the user should fix. */
export class ValidationError extends Error {
  constructor(
    readonly code: ValidationCode,
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface SensitiveMatch {
  readonly field: string;
  readonly matches: readonly string[];
}

/**
 * Text that looks like an IP address or host name (security-controls CON-001, decision Q-032).
 * Nothing was written; repeat the write with `{ confirmSensitive: true }` to save anyway.
 */
export class SensitiveInputWarning extends Error {
  constructor(readonly findings: readonly SensitiveMatch[]) {
    super(
      `These values look like IP addresses or host names: ${findings
        .map((f) => `${f.field} (${f.matches.join(", ")})`)
        .join("; ")}. SIM is meant to stay free of host data; confirm to save anyway.`,
    );
    this.name = "SensitiveInputWarning";
  }
}
