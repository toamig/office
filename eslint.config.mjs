import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "out/**",
      "out-web/**",
      "release/**",
      "node_modules/**",
      ".dev/**",
      "tests/fixtures/**/template/**",
      "tests/fixtures/bin/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: globals.browser },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ["src/main/**/*.ts", "src/preload/**/*.ts", "scripts/**/*.mjs", "tests/**/*.ts", "resources/relay/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "child_process", message: "Use core/exec.ts" },
            { name: "node:child_process", message: "Use core/exec.ts" },
          ],
        },
      ],
    },
  },
  {
    files: ["src/main/core/exec.ts", "tests/**", "scripts/**", "resources/relay/**"],
    rules: { "no-restricted-imports": "off" },
  },
  prettier,
);
