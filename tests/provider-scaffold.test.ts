import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scaffoldProvider } from "../packages/sdk/src/scaffold.ts";

test("provider scaffold creates a reviewed v1 starter without granting verdict authority", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-provider-scaffold-"));
  const result = await scaffoldProvider(root, "static-checks", "com.example.static-checks");
  assert.deepEqual(result.files, ["package.json", "README.md", "src/index.ts", "tests/provider.test.ts"]);
  const source = await readFile(join(result.directory, "src/index.ts"), "utf8");
  const regression = await readFile(join(result.directory, "tests/provider.test.ts"), "utf8");
  assert.match(source, /defineVerificationProvider/);
  assert.match(source, /com\.example\.static-checks/);
  assert.match(source, /git diff --check/);
  assert.doesNotMatch(source, /EvidenceRecord|verdict:/);
  assert.match(regression, /resolveProviderCommands/);
});

test("provider scaffold validates names, stays inside root, and never overwrites", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-provider-scaffold-"));
  await assert.rejects(scaffoldProvider(root, "Bad Name", "com.example.bad"), /kebab-case/);
  await assert.rejects(scaffoldProvider(root, "valid", "invalid"), /reverse-domain/);
  await assert.rejects(scaffoldProvider(root, "valid", "com.example.valid", "../outside"), /inside the project root/);
  await scaffoldProvider(root, "valid", "com.example.valid");
  await assert.rejects(scaffoldProvider(root, "valid", "com.example.valid"), /EEXIST/);
});
