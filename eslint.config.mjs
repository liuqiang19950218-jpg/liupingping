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
    ".cache/**",
    ".openai/**",
    ".vinext/**",
    ".wrangler/**",
    "node_modules/**",
    "outputs/**",
    "work/**",
    "dist/**",
    "out/**",
    "build/**",
    "site-package-*/**",
    "next-env.d.ts",
  ]),
  {
    // The existing application hydrates browser-persisted business state after
    // mount. Keep React 19's migration hints visible without blocking releases.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "prefer-const": "warn",
    },
  },
]);

export default eslintConfig;
