import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      prettier: prettierPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...prettierConfig.rules,
      "prettier/prettier": "error",
      "no-var": "error",
      eqeqeq: "error",
      // Complexity threshold raised: callback dispatch is inherently sequential — refactorization would introduce unnecessary indirection.
      complexity: ["warn", { max: 20 }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error", // AGRESIVO
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off", // Permitido en tests para mocks
    },
  },
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "**/package-lock.json",
      "logs/**",
      "borg-frontend-tele-app/**",
      "eslint.config.js",
      "scripts/**",
      "coverage/**",
    ],
  },
);
