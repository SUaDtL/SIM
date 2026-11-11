import { SensitiveInputWarning, type SensitiveMatch, ValidationError } from "./errors";

export const MAX_NAME_LENGTH = 200;

const OCTET = "(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)";
const IPV4 = new RegExp(`(?<![\\w.])(?:${OCTET}\\.){3}${OCTET}(?:/\\d{1,2})?(?![\\w.])`, "g");
const IPV6_CANDIDATE = /[0-9a-f:]*:[0-9a-f:]*:[0-9a-f:]*/gi;
const IPV6 = /^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i;
// Two or more dot-separated labels ending in an alphabetic TLD: mail.j6.example.mil, Box.com.
const HOST = /(?<![\w.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?![\w-])/gi;

/** Substrings of `text` that look like IPv4/IPv6 addresses or dotted host names. */
export function findSensitive(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(IPV4)) found.add(m[0]);
  for (const m of text.matchAll(IPV6_CANDIDATE)) {
    const token = m[0];
    const colons = token.split(":").length - 1;
    // Require "::" or a full 8-group address so times like 10:30:00 are not flagged.
    if (IPV6.test(token) && /[0-9a-f]/i.test(token) && (token.includes("::") || colons === 7)) found.add(token);
  }
  for (const m of text.matchAll(HOST)) found.add(m[0]);
  return [...found];
}

/** Throw SensitiveInputWarning when any field looks like host data, unless the user confirmed. */
export function checkSensitive(fields: Record<string, string | null | undefined>, confirmed: boolean): void {
  if (confirmed) return;
  const findings: SensitiveMatch[] = [];
  for (const [field, value] of Object.entries(fields)) {
    const matches = value ? findSensitive(value) : [];
    if (matches.length > 0) findings.push({ field, matches });
  }
  if (findings.length > 0) throw new SensitiveInputWarning(findings);
}

export function cleanName(value: string, field: string): string {
  const name = value.trim();
  if (!name) throw new ValidationError("REQUIRED", field, `The ${field} is required.`);
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError("TOO_LONG", field, `The ${field} must be at most ${String(MAX_NAME_LENGTH)} characters.`);
  }
  return name;
}

/** Optional free text: trimmed, with empty strings stored as null. */
export function cleanText(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text ? text : null;
}
