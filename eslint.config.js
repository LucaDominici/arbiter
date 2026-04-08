import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
          allowNullish: true,
        },
      ],
    },
  },
  // Complexity rules for source files
  {
    files: ["src/**/*.ts"],
    rules: {
      complexity: ["error", 15],
      "max-params": ["error", 5],
      "max-depth": ["error", 4],
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
      "max-nested-callbacks": ["error", 3],
    },
  },
  // Test files are not in tsconfig.json — disable type-aware rules and relax style rules
  {
    files: ["__tests__/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: [
      "dist/",
      "node_modules/",
      "vitest.config.ts",
      "eslint.config.js",
      "src/templates/",
      "scripts/",
    ],
  },
);
