import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { collectCommandEvidence, collectVerificationEvidence } from "../packages/evidence/src/index.ts";
import { repositoryState } from "../packages/git/src/index.ts";
import { writeJson, type ProjectConfig } from "../packages/core/src/index.ts";
import { bindRequirement, createIntent } from "../packages/intent/src/index.ts";
import { verifyProject } from "../packages/verifier/src/project.ts";

const exec = promisify(execFile);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "pm-lifecycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "value.js"), "export const value = true;\n");
  await writeFile(join(root, "lifecycle-child.mjs"), `
import { writeFile } from "node:fs/promises";
const [marker] = process.argv.slice(2);
setTimeout(() => void writeFile(marker, "orphaned\n"), 800);
setInterval(() => {}, 1000);
`);
  await writeFile(join(root, "lifecycle-fixture.mjs"), `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [mode, marker] = process.argv.slice(2);
if (mode === "success") process.stdout.write("portable-success");
else if (mode === "failure") { process.stderr.write("portable-failure"); process.exitCode = 7; }
else if (mode === "flood") process.stdout.write("x".repeat(2 * 1024 * 1024));
else if (mode === "mutate") writeFileSync("src/value.js", "export const value = false;\\n");
else if (mode === "tree") {
  spawn(process.execPath, ["lifecycle-child.mjs", marker], { stdio: "ignore" });
  setInterval(() => {}, 1000);
}
`);
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["-c", "user.name=ProjectMind Test", "-c", "user.email=test@example.com", "add", "."], { cwd: root });
  await exec("git", ["-c", "user.name=ProjectMind Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], { cwd: root });
  return root;
}

test("portable command lifecycle records success, failure, and one run lineage", async (t) => {
  const root = await fixture(t);
  const config: ProjectConfig = {
    version: 1,
    project: { name: "lifecycle", root: "." },
    scanner: { include: ["src"], extensions: [".js"], exclude: [] },
    verification: { commands: [
      { kind: "test", command: "node lifecycle-fixture.mjs success", required: true },
      { kind: "test", command: "node lifecycle-fixture.mjs failure", required: false },
    ] },
  };
  const before = await repositoryState(root);
  const evidence = await collectVerificationEvidence(root, config);
  assert.equal(evidence[0]?.exitCode, 0);
  assert.equal(evidence[0]?.stdout, "portable-success");
  assert.equal(evidence[1]?.exitCode, 7);
  assert.equal(evidence[1]?.stderr, "portable-failure");
  assert.equal(evidence[0]?.runId, evidence[1]?.runId);
  for (const record of evidence) {
    assert.equal(record.repositoryState, before);
    assert.equal(record.repositoryStateAfter, before);
  }
});

test("portable lifecycle bounds output and terminates timeout descendants", async (t) => {
  const root = await fixture(t);
  const flood = await collectCommandEvidence(root, { kind: "test", command: "node lifecycle-fixture.mjs flood", required: true });
  assert.equal(flood.termination, "output-limit");
  assert.equal(flood.exitCode, 1);
  assert.ok(flood.stdout.length <= 20_000);

  const marker = join(root, "orphan-marker.txt");
  const timeout = await collectCommandEvidence(root, {
    kind: "test",
    command: `node lifecycle-fixture.mjs tree ${JSON.stringify(marker)}`,
    required: true,
    timeoutMs: 300,
  });
  assert.equal(timeout.termination, "timeout");
  assert.equal(timeout.exitCode, 1);
  assert.ok(timeout.durationMs < 5_000);
  await delay(1_000);
  await assert.rejects(access(marker));
});

test("portable lifecycle records repository mutation across execution", async (t) => {
  const root = await fixture(t);
  const evidence = await collectCommandEvidence(root, { kind: "test", command: "node lifecycle-fixture.mjs mutate", required: true });
  assert.equal(evidence.exitCode, 0);
  assert.notEqual(evidence.repositoryState, evidence.repositoryStateAfter);
  assert.equal(await readFile(join(root, "src", "value.js"), "utf8"), "export const value = false;\n");
});

test("portable command lifecycle completes end-to-end verification", async (t) => {
  const root = await fixture(t);
  const command = "node lifecycle-fixture.mjs success";
  const config: ProjectConfig = {
    version: 1,
    project: { name: "lifecycle", root: "." },
    scanner: { include: ["src"], extensions: [".js"], exclude: [] },
    verification: { commands: [{ kind: "build", command, required: true }] },
  };
  await writeJson(join(root, ".projectmind", "config.json"), config);
  await writeJson(join(root, ".projectmind", "constitution.json"), { version: 1, dependencyRules: [], sensitivePaths: [] });
  await createIntent(root, "Portable lifecycle", ["Portable command succeeds"], [], [], ["build"]);
  await bindRequirement(root, "REQ-1", command);
  const { evidence, result, proof } = await verifyProject(root);
  assert.equal(result.status, "VERIFIED");
  assert.equal(proof.verification.status, "VERIFIED");
  assert.equal(evidence[0]?.repositoryState, evidence[0]?.repositoryStateAfter);
});
