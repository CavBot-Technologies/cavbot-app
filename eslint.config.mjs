import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const cssNoopParser = {
  parseForESLint(code) {
    const source = String(code || "");
    const lines = source.split(/\r\n|\r|\n/);
    const lastLine = lines[lines.length - 1] || "";
    return {
      ast: {
        type: "Program",
        body: [],
        comments: [],
        sourceType: "script",
        tokens: [],
        range: [0, source.length],
        loc: {
          start: { line: 1, column: 0 },
          end: { line: lines.length, column: lastLine.length },
        },
      },
    };
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.css"],
    languageOptions: {
      parser: cssNoopParser,
    },
    rules: {},
  },
  // Override default ignores of eslint-config-next.
globalIgnores([
  // Default ignores of eslint-config-next:
  ".next/**",
  ".open-next/**",
  ".vercel/**",
  "out/**",
  "build/**",
  "next-env.d.ts",
  // Static assets / vendored bundles: don't lint.
  "public/**",
  "clients/**",
  "dev.db",
  "clients/cavbot-cdn/sdk/cavai/v1/cavai.min.js",
]),
{
  // App-specific overrides.
  files: ["app/cavbot-arcade/**"],
  rules: {
    // This rule flags intentional state resets inside effects used for media preload UX.
    // Keep the behavior; disable the rule for Arcade only.
    "react-hooks/set-state-in-effect": "off",
  },
},
]);

export default eslintConfig;
