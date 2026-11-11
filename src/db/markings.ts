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
