import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const BANNED_MATH = [
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "exp",
  "expm1",
  "log",
  "log2",
  "log10",
  "log1p",
  "pow",
  "hypot",
  "cbrt",
  "random",
  "sinh",
  "cosh",
  "tanh",
];

const determinismProperties = [
  ...BANNED_MATH.map((property) => ({
    object: "Math",
    property,
    message: "Non-deterministic across engines; use src/core/dmath.ts (D06).",
  })),
  { object: "Date", property: "now", message: "The simulation never reads the clock (§7.1)." },
  {
    object: "performance",
    property: "now",
    message: "The simulation never reads the clock (§7.1).",
  },
];

const determinismSyntax = [
  {
    selector: "BinaryExpression[operator='**']",
    message: "`**` is banned in deterministic code (D06); multiply explicitly.",
  },
  {
    selector: "AssignmentExpression[operator='**=']",
    message: "`**=` is banned in deterministic code (D06).",
  },
];

const levelDataImports = {
  patterns: [
    {
      group: ["*.json", "*.yaml", "*.yml", "**/*.json", "**/*.yaml", "**/*.yml", "*.json?*"],
      message: "Level data may only be imported by src/levels/manifest.ts (D20c).",
    },
  ],
};

const pureLayerImports = {
  patterns: [
    ...levelDataImports.patterns,
    {
      group: [
        "**/render/**",
        "**/ui/**",
        "**/audio/**",
        "**/input/**",
        "**/game/**",
        "**/builder/**",
        "preact",
        "preact/*",
        "@preact/*",
      ],
      message: "src/core, src/sim and src/level must stay pure (§3.2).",
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-server/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      "levels/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/levels/manifest.ts"],
    rules: {
      "no-restricted-imports": ["error", levelDataImports],
    },
  },
  {
    files: ["src/sim/**/*.ts", "src/level/**/*.ts", "src/core/**/*.ts"],
    rules: {
      "no-restricted-properties": ["error", ...determinismProperties],
      "no-restricted-syntax": ["error", ...determinismSyntax],
      "no-restricted-imports": ["error", pureLayerImports],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
  },
);
