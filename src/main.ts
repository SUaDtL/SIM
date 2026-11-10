import { openDatabase, sqliteVersion } from "./db/sqlite";

async function boot(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) throw new Error("missing #app root");
  const db = await openDatabase();
  const header = document.createElement("header");
  const title = document.createElement("h1");
  title.textContent = "SIM - Service Integration Map";
  const version = document.createElement("p");
  version.dataset["testid"] = "sqlite-version";
  version.textContent = `SQLite ${sqliteVersion(db)}`;
  header.append(title, version);
  app.replaceChildren(header);
}

void boot();
