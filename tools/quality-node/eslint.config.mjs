export default [
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        process: "readonly",
        Buffer: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-undef": "error",
      "constructor-super": "error",
      "no-unreachable": "error",
      "valid-typeof": "error",
    },
  },
];
