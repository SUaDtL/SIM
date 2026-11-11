import js from "@eslint/js";
import tseslint from "typescript-eslint";

const networkApis = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"];
const storageApis = ["localStorage", "sessionStorage", "indexedDB"];
const policy = "is prohibited in shipped code (security-controls FACT-002)";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "playwright-report/", "test-results/", ".codearbiter/"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // Prohibited primitives in shipped code. Tests and tooling may use Node and network APIs.
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "@typescript-eslint/no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-globals": [
        "error",
        ...[...networkApis, ...storageApis].map((name) => ({ name, message: `${name} ${policy}.` })),
      ],
      "no-restricted-properties": [
        "error",
        ...["window", "globalThis", "self"].flatMap((object) =>
          [...networkApis, ...storageApis].map((property) => ({
            object,
            property,
            message: `${property} ${policy}.`,
          })),
        ),
        { object: "navigator", property: "sendBeacon", message: `sendBeacon ${policy}.` },
        { object: "document", property: "cookie", message: `document.cookie ${policy}.` },
        { object: "document", property: "write", message: `document.write ${policy}.` },
        { object: "document", property: "writeln", message: `document.writeln ${policy}.` },
        { object: "Math", property: "random", message: `Math.random ${policy}; use crypto.getRandomValues.` },
      ],
      "no-restricted-syntax": [
        "error",
        ...["innerHTML", "outerHTML"].map((property) => ({
          selector: `AssignmentExpression > MemberExpression.left[property.name='${property}']`,
          message: `${property} ${policy}; build DOM with textContent/createElement.`,
        })),
        {
          // Core no-implied-eval needs declared browser globals; this catches string timers directly.
          selector:
            "CallExpression:matches([callee.name=/^set(Timeout|Interval)$/], [callee.property.name=/^set(Timeout|Interval)$/]) > :matches(Literal[value=/./], TemplateLiteral).arguments:first-child",
          message: `String arguments to setTimeout/setInterval ${policy}; pass a function.`,
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: `insertAdjacentHTML ${policy}; build DOM with textContent/createElement.`,
        },
      ],
    },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
);
