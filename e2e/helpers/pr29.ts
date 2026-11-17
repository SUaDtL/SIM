import { readFileSync } from "node:fs";
import { rawDatabase } from "../../tests/helpers/sqlite";

/** Trusted, readable synthetic test fixtures; never used by the shipped application. */
export async function pr29Fixture(name: "enterprise" | "four-change-scenario" | "demo-arrangement"): Promise<Buffer> {
  const db = await rawDatabase();
  try {
    // SQLite retains schema SQL verbatim; match the migrations' LF on Windows checkouts too.
    db.exec(readFileSync(new URL(`../fixtures/pr29/${name}.sql`, import.meta.url), "utf8").replace(/\r\n/g, "\n"));
    return Buffer.from(db.export());
  } finally {
    db.close();
  }
}
