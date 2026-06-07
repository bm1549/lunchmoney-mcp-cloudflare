import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist/**", "node_modules/**"] },
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                project: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Numbers are safely serialisable in template literals.
            "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
            // Conventional _-prefix signals intentionally unused params/vars.
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
            }],
        },
    },
    {
        // In test files the () => expect(...).toBe(...) shorthand is idiomatic vitest.
        files: ["src/**/*.test.ts"],
        rules: {
            "@typescript-eslint/no-confusing-void-expression": "off",
        },
    },
);
