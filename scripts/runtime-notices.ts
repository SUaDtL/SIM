import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

interface PackageMetadata {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly dependencies: readonly string[];
  readonly optional: readonly string[];
  readonly peers: readonly string[];
}

export interface RuntimeNotice {
  readonly title: string;
  readonly license: string;
  readonly files: readonly { readonly name: string; readonly text: string }[];
}

const allowed = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
]);

function metadata(directory: string): PackageMetadata {
  const parsed: unknown = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error(`Invalid package metadata in ${directory}`);
  const value = parsed as Record<string, unknown>;
  for (const key of ["name", "version", "license"]) {
    if (typeof value[key] !== "string" || !value[key]) throw new Error(`Missing ${key} in ${directory}`);
  }
  const names = (key: string): string[] => {
    const object = value[key];
    if (object === undefined) return [];
    if (typeof object !== "object" || object === null || Array.isArray(object)) {
      throw new Error(`Invalid ${key} in ${directory}`);
    }
    const result = Object.keys(object);
    if (result.some((name) => !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name))) {
      throw new Error(`Unsafe dependency name in ${directory}`);
    }
    return result.sort();
  };
  return {
    name: value["name"] as string,
    version: value["version"] as string,
    license: value["license"] as string,
    dependencies: names("dependencies"),
    optional: names("optionalDependencies"),
    peers: names("peerDependencies"),
  };
}

function licenseFiles(directory: string): RuntimeNotice["files"] {
  // Notice documents may have a license-family suffix (LICENSE-MIT, LICENSE.BSD)
  // and a text extension. A prefix alone also matches upstream maintenance scripts.
  const document =
    /^(?:licen[cs]e|copying|notice|authors)(?:[-_][a-z0-9-]+|\.(?:mit|bsd))?(?:\.(?:txt|md|markdown|rst|text))?$/i;
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && document.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!files.some((entry) => /^(?:licen[cs]e|copying)(?:[._-].*)?$/i.test(entry.name))) {
    throw new Error(`Missing runtime license text in ${directory}`);
  }
  return files.map(({ name }) => {
    const text = readFileSync(join(directory, name), "utf8").replace(/\r\n/g, "\n");
    if (!text.trim()) throw new Error(`Empty runtime notice ${join(directory, name)}`);
    return { name, text };
  });
}

/** Traverse installed production dependencies, not dev tooling or a hard-coded package list. */
export function collectRuntimeNotices(projectRoot: string): readonly RuntimeNotice[] {
  const root = realpathSync(projectRoot);
  const installed = join(root, "node_modules");
  const project = metadata(root);
  const projectNotice = {
    title: `Project license: ${project.name}@${project.version}`,
    license: project.license,
    files: licenseFiles(root),
  };
  const notices: RuntimeNotice[] = [];
  const visited = new Set<string>();
  const visit = (from: string, name: string, optional = false): void => {
    const search = createRequire(join(from, "package.json")).resolve.paths(name) ?? [];
    const packageFile = search.map((path) => join(path, name, "package.json")).find((path) => existsSync(path));
    if (!packageFile) {
      if (optional) return;
      throw new Error(`Missing installed runtime dependency ${name} from ${from}`);
    }
    const directory = realpathSync(resolve(packageFile, ".."));
    const scope = relative(installed, directory);
    if (isAbsolute(scope) || scope === ".." || scope.startsWith(`..${sep}`)) {
      throw new Error(`Runtime dependency ${name} is outside the installed dependency tree`);
    }
    if (visited.has(directory)) return;
    visited.add(directory);
    const pkg = metadata(directory);
    if (pkg.name !== name || !allowed.has(pkg.license)) {
      throw new Error(`Unqualified runtime license for ${name}: ${pkg.license}`);
    }
    notices.push({
      title: `Bundled package: ${pkg.name}@${pkg.version}`,
      license: pkg.license,
      files: licenseFiles(directory),
    });
    const optionalNames = new Set(pkg.optional);
    for (const dependency of pkg.dependencies) visit(directory, dependency, optionalNames.has(dependency));
    for (const dependency of pkg.optional) visit(directory, dependency, true);
    for (const peer of pkg.peers) visit(directory, peer, true);
  };
  for (const name of project.dependencies) visit(root, name, project.optional.includes(name));
  for (const name of project.optional) visit(root, name, true);
  return [projectNotice, ...notices.sort((a, b) => a.title.localeCompare(b.title))];
}

export const escapeNoticeText = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function noticeDialog(notices: readonly RuntimeNotice[]): string {
  return (
    '<dialog id="sim-license-dialog" class="license-dialog" aria-labelledby="sim-license-title">' +
    '<header class="reading-heading"><h2 id="sim-license-title">Licenses and notices</h2>' +
    '<button id="sim-license-close" type="button">Close licenses</button></header>' +
    '<div class="license-body"><p>Read the licenses for SIM and the components bundled in this offline copy.</p>' +
    '<label class="assessment-field">Jump to component<select id="sim-license-component"><option value="">Choose a component</option>' +
    notices
      .map(
        (notice, i) => `<option value="sim-license-component-${String(i)}">${escapeNoticeText(notice.title)}</option>`,
      )
      .join("") +
    "</select></label>" +
    notices
      .map(
        (notice, i) =>
          `<section><h3 id="sim-license-component-${String(i)}" tabindex="-1">${escapeNoticeText(notice.title)} (${escapeNoticeText(notice.license)})</h3>` +
          notice.files
            .map((file) => `<h4>${escapeNoticeText(file.name)}</h4><pre>${escapeNoticeText(file.text)}</pre>`)
            .join("") +
          "</section>",
      )
      .join("") +
    "</div></dialog>"
  );
}

/** Static text survives bundling/minification and travels with the only released artifact. */
export function runtimeNoticesPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: "sim:runtime-notices",
    enforce: "post",
    configResolved(config) {
      root = config.root;
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (!html.includes("</body>")) throw new Error("Cannot embed SIM runtime notices: body end is missing");
        return html.replace("</body>", noticeDialog(collectRuntimeNotices(root)) + "</body>");
      },
    },
  };
}
