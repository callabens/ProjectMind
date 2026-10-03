import { defineVerificationProvider, PROVIDER_API_VERSION } from "../index.ts";

export const eslintCheckProvider = defineVerificationProvider({
  manifest: {
    apiVersion: PROVIDER_API_VERSION,
    id: "dev.projectmind.eslint-check",
    displayName: "ESLint check",
    version: "1.0.0",
    capabilities: ["verification-commands"],
  },
  commands: () => [{
    kind: "lint",
    command: "npx --no-install eslint .",
    required: false,
    provider: "generic-command",
    timeoutMs: 60_000,
  }],
});
