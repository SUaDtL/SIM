/** Classification levels, lowest to highest (decomposition Q-018, Q-029). */
export const MARKINGS = ["UNCLASSIFIED", "CUI", "CONFIDENTIAL", "SECRET", "TOP SECRET"] as const;

export type Marking = (typeof MARKINGS)[number];

export function isMarking(value: unknown): value is Marking {
  return typeof value === "string" && (MARKINGS as readonly string[]).includes(value);
}

/** The banner rule: anything marked higher raises the whole view to that level. */
export function highestMarking(markings: Iterable<Marking>): Marking {
  let highest = 0;
  for (const m of markings) highest = Math.max(highest, MARKINGS.indexOf(m));
  return MARKINGS[highest] ?? "UNCLASSIFIED";
}

/** Longest banner caveat, e.g. "REL TO USA, FVEY" (decomposition Q-029). */
export const MAX_CAVEAT_LENGTH = 80;

/**
 * A caveat uses letters, digits, spaces, commas, hyphens and slashes only. With no dots or colons
 * it cannot hold an IP address or host name (security-controls CON-001), and opened files are held
 * to the same rule because the meta table has no constraints of its own.
 */
export const CAVEAT_PATTERN = /^[A-Z0-9 ,/-]+$/;

/** The stored form of a caveat: trimmed, upper case, without leading slashes; null when empty. */
export function normalizeCaveat(value: string | null | undefined): string | null {
  const caveat = (value ?? "").trim().toUpperCase().replace(/^\/+/, "").trim();
  return caveat ? caveat : null;
}

export function isValidCaveat(caveat: string): boolean {
  return caveat.length <= MAX_CAVEAT_LENGTH && CAVEAT_PATTERN.test(caveat);
}

/** Banner text: the computed marking always comes first; a caveat can only follow it. */
export function bannerText(marking: Marking, caveat: string | null): string {
  return caveat ? `${marking}//${caveat}` : marking;
}
