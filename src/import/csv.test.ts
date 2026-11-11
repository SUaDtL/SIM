import { describe, expect, it } from "vitest";
import { CsvError, decodeCsv, MAX_FIELD_LENGTH, parseCsv, toCsv } from "./csv";

const fields = (text: string) => parseCsv(text).map((r) => r.fields);

describe("parseCsv", () => {
  it("reads plain, quoted and escaped fields with CRLF or LF", () => {
    expect(fields('a,b,c\r\n1,"two, too","say ""hi"""\n')).toEqual([
      ["a", "b", "c"],
      ["1", "two, too", 'say "hi"'],
    ]);
  });

  it("keeps line breaks inside quotes and numbers rows as a spreadsheet does", () => {
    const rows = parseCsv('name,description\nEmail,"line one\nline two"\nChat,ok\n');
    expect(rows.map((r) => [r.row, r.fields[1]])).toEqual([
      [1, "description"],
      [2, "line one\nline two"],
      [4, "ok"],
    ]);
  });

  it("drops a byte-order mark and skips blank rows, but keeps ragged rows for the template to judge", () => {
    expect(fields("﻿a,b\n,,\n\n1\n")).toEqual([["a", "b"], ["1"]]);
  });

  it("reports an unclosed quote at the row where it starts", () => {
    expect(() => parseCsv('a,b\n1,"open\n2,3\n')).toThrow(new CsvError("A quoted value is never closed.", 2));
  });

  it("refuses over-long values", () => {
    expect(() => parseCsv(`a\n${"x".repeat(MAX_FIELD_LENGTH + 1)}\n`)).toThrow(/longer than/);
  });

  it("refuses text that is not UTF-8", () => {
    expect(() => decodeCsv(new Uint8Array([0x61, 0xff, 0x62]))).toThrow(/CSV UTF-8/);
    expect(decodeCsv(new TextEncoder().encode("﻿a,b"))).toBe("a,b");
  });

  it("writes CSV that reads back the same", () => {
    const rows = [
      ["name", "description"],
      ["A, B", 'say "x"\nnext'],
    ];
    const text = toCsv(rows);
    expect(text.startsWith("﻿")).toBe(true);
    expect(fields(text)).toEqual(rows);
  });
});
