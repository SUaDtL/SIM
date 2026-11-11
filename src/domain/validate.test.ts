import { describe, expect, it } from "vitest";
import { ValidationError } from "./errors";
import { cleanName, findSensitive, MAX_NAME_LENGTH } from "./validate";

describe("findSensitive", () => {
  it.each([
    ["10.2.3.4", "10.2.3.4"],
    ["gateway at 192.168.0.1 on SIPR", "192.168.0.1"],
    ["subnet 172.16.0.0/12", "172.16.0.0/12"],
    ["fe80::1ff:fe23:4567:890a", "fe80::1ff:fe23:4567:890a"],
    ["2001:db8:85a3:0:0:8a2e:370:7334", "2001:db8:85a3:0:0:8a2e:370:7334"],
    ["::1", "::1"],
    ["mail.j6.example.mil", "mail.j6.example.mil"],
    ["see https://portal.example.com/page", "portal.example.com"],
    ["Box.com", "Box.com"],
  ])("flags %j", (text, match) => {
    expect(findSensitive(text)).toContain(match);
  });

  it.each([
    "Microsoft 365",
    "ServiceNow",
    "Email",
    "C2 Common Op Picture",
    "Version 3.2",
    "Tier 1 support, 24x7",
    "Meets at 10:30",
    "e.g. the J6 desk",
    "U.S. Army",
    "Windows 10.0",
    "",
  ])("does not flag %j", (text) => {
    expect(findSensitive(text)).toEqual([]);
  });

  it("rejects out-of-range octets as addresses", () => {
    expect(findSensitive("version 999.1.1.1")).toEqual([]);
  });
});

describe("cleanName", () => {
  it("trims names", () => {
    expect(cleanName("  NIPR  ", "name")).toBe("NIPR");
  });

  it("rejects blank names", () => {
    expect(() => cleanName("   ", "name")).toThrow(ValidationError);
  });

  it("rejects names longer than the limit", () => {
    expect(() => cleanName("x".repeat(MAX_NAME_LENGTH + 1), "name")).toThrow(/at most 200/);
  });

  it("names the offending field", () => {
    try {
      cleanName("", "network name");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).field).toBe("network name");
    }
  });
});
