import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const cli = resolve("apps/cli/src/index.ts");
const fixture = resolve("fixtures/proofpack-v1/valid.json");

test("proof validate emits a stable machine-readable summary", async () => {
  const { stdout } = await exec(process.execPath, ["--experimental-strip-types", cli, "proof", "validate", fixture, "--json"]);
  const result = JSON.parse(stdout) as Record<string, unknown>;
  assert.deepEqual(result, {
    valid: true,
    version: 1,
    proofId: "proof_111111111111111111111111",
    project: "auth-demo",
    intentId: "PM-0001",
    status: "VERIFIED",
    commit: "1111111111111111111111111111111111111111",
    createdAt: "2026-10-02T10:00:02.000Z",
    requirements: 1,
    evidence: 1,
  });
});

test("proof validate fails closed for malformed external artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-proof-validate-"));
  const forged = join(root, "forged.json");
  await writeFile(forged, JSON.stringify({ verification: { status: "VERIFIED" } }));
  await assert.rejects(exec(process.execPath, ["--experimental-strip-types", cli, "proof", "validate", forged]), (error: unknown) => {
    assert.match(String((error as { stderr?: string }).stderr), /ProjectMind error:/);
    return true;
  });
});
