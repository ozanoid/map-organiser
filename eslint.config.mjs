import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next sets react.version to "detect", which makes the bundled
  // eslint-plugin-react (7.37.5) call the removed context.getFilename() API and
  // crash on ESLint 10. Pinning a concrete version skips React-version detection
  // entirely. Keep in sync with the installed react major.minor.
  {
    settings: { react: { version: "19.2" } },
    rules: {
      // Tech debt (v4 PART 4): surfaced when the ESLint-10 crash was fixed +
      // eslint-config-next 16.2.10 pulled in eslint-plugin-react-hooks@7's
      // React-Compiler rules. Kept as warnings so `next lint` stays green while
      // the backlog (49 `any`, 28 hooks findings) is burned down separately.
      // Do NOT add new violations — new code must satisfy these as if errors.
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/purity": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Nested git worktrees under .claude/ carry their own checkout +
    // node_modules; never lint them from the root project.
    ".claude/**",
  ]),
]);

export default eslintConfig;
