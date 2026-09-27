import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local editor-tool worktrees (gitignored) hold full copies of other
    // branches, including older code. They are not
    // this tree and must not fail its lint.
    ".kilo/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
