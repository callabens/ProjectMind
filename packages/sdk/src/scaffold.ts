import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface ProviderScaffoldResult {
  directory: string;
  files: string[];
}

function assertSlug(value: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error("Provider name must be a lowercase kebab-case slug.");
}

function assertProviderId(value: string): void {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value)) throw new Error("Provider id must be a reverse-domain-style lowercase identifier.");
}

export async function scaffoldProvider(root: string, name: string, providerId: string, directory?: string): Promise<ProviderScaffoldResult> {
  assertSlug(name);
  assertProviderId(providerId);
  if (directory && isAbsolute(directory)) throw new Error("Provider scaffold directory must be relative to the project root.");
  const target = resolve(root, directory ?? `providers/${name}`);
  const pathFromRoot = relative(resolve(root), target);
  if (!pathFromRoot || pathFromRoot === ".." || pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Provider scaffold directory must stay inside the project root.");
  }
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  const displayName = name.split("-").map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`).join(" ");
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({
      name: `projectmind-provider-${name}`,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: { test: "node --experimental-strip-types --test tests/*.test.ts" },
      dependencies: { "@callabens/projectmind": "0.1.0-dev.1" },
      engines: { node: ">=22.18" },
    }, null, 2)}\n`,
    "src/index.ts": `import { defineVerificationProvider, PROVIDER_API_VERSION } from "@callabens/projectmind/provider-sdk";\n\nexport const provider = defineVerificationProvider({\n  manifest: {\n    apiVersion: PROVIDER_API_VERSION,\n    id: ${JSON.stringify(providerId)},\n    displayName: ${JSON.stringify(displayName)},\n    version: "0.1.0",\n    capabilities: ["verification-commands"],\n  },\n  commands: () => [{\n    kind: "static",\n    command: "git diff --check",\n    required: false,\n    provider: "generic-command",\n    timeoutMs: 30_000,\n  }],\n});\n`,
    "tests/provider.test.ts": `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { resolveProviderCommands } from "@callabens/projectmind/provider-sdk";\nimport { provider } from "../src/index.ts";\n\ntest("provider returns validated commands without evidence or verdicts", async () => {\n  const commands = await resolveProviderCommands(provider, { root: process.cwd(), project: { name: "fixture", root: "." } });\n  assert.equal(commands.length, 1);\n  assert.equal(commands[0]?.command, "git diff --check");\n  assert.equal("evidence" in provider, false);\n  assert.equal("verdict" in provider, false);\n});\n`,
    "README.md": `# ${displayName} ProjectMind provider\n\nGenerated from Provider SDK v1. Review every command before installation. Providers contribute command definitions only; ProjectMind retains execution, evidence, freshness and verdict authority.\n\n## Develop\n\n\`\`\`bash\nnpm install\nnpm test\n\`\`\`\n`,
  };
  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const output = resolve(target, path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, content, { encoding: "utf8", flag: "wx" });
  }));
  return { directory: target, files: Object.keys(files).sort((left, right) => left.localeCompare(right, "en")) };
}
