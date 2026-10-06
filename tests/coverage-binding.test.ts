import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { collectCommandEvidence, parseLcovCoverage } from "../packages/evidence/src/index.ts";
import { verifyIntent } from "../packages/verifier/src/index.ts";
import type { EvidenceRecord, IntentContract, ProjectConfig } from "../packages/core/src/index.ts";
import { configSchema } from "../packages/core/src/schema.ts";
import { initializeProject } from "../packages/core/src/project.ts";

const state = "a".repeat(64);
const command = "node --test --test-reporter=junit tests/auth.test.js";
const config: ProjectConfig = {
  version: 1,
  project: { name: "coverage-fixture", root: "." },
  scanner: { include: ["."], extensions: [".ts"], exclude: [] },
  verification: { commands: [{ kind: "test", command, required: true, provider: "node-test-junit", coveragePath: ".projectmind/runtime/lcov.info" }] },
};
const intent: IntentContract = {
  version: 1,
  id: "PM-0001",
  title: "Protect authentication",
  createdAt: "2026-10-06T00:00:00.000Z",
  requirements: [{
    id: "REQ-1", statement: "Login stays covered", critical: true, evidenceKinds: ["test"],
    evidenceCommands: [command], evidenceTests: ["login succeeds"], coveragePaths: ["src/auth.ts"],
  }],
  preserve: [],
  outOfScope: [],
};

function evidence(linesHit: number): EvidenceRecord {
  return {
    version: 1, id: "ev_111111111111111111111111", kind: "test", command,
    startedAt: "2026-10-06T00:00:00.000Z", finishedAt: "2026-10-06T00:00:01.000Z", durationMs: 1000,
    exitCode: 0, stdout: "", stderr: "", runId: "run-1", repositoryState: state, repositoryStateAfter: state,
    provider: "node-test-junit",
    testSummary: { provider: "node-test-junit", discovered: 1, passed: 1, failed: 0, skipped: 0, cases: [{ id: "test_111111111111111111111111", name: "login succeeds", status: "passed" }] },
    coverageSummary: { provider: "lcov", files: [{ path: "src/auth.ts", linesFound: 4, linesHit }] },
  };
}

test("LCOV parser normalizes repository files and accumulates line hits", () => {
  const summary = parseLcovCoverage("/repo", [
    "TN:", "SF:src/auth.ts", "DA:1,2", "DA:2,0", "end_of_record",
    "SF:/repo/src/auth.ts", "DA:2,3", "DA:3,0", "end_of_record",
  ].join("\n"));
  assert.deepEqual(summary.files, [{ path: "src/auth.ts", linesFound: 3, linesHit: 2 }]);
  assert.throws(() => parseLcovCoverage("/repo", "SF:../outside.ts\nDA:1,1\nend_of_record"), /escapes/);
  assert.throws(() => configSchema.parse({ ...config, verification: { commands: [{ ...config.verification.commands[0], coveragePath: "coverage/lcov.info" }] } }), /\.projectmind\/runtime/);
});

test("coverage collection removes stale LCOV and records only the fresh report", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-coverage-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "coverage-runner" }));
  await initializeProject(root);
  await writeFile(join(root, "runner.mjs"), [
    "import { writeFile } from 'node:fs/promises';",
    "await writeFile('.projectmind/runtime/lcov.info', 'SF:src/auth.ts\\nDA:1,1\\nend_of_record\\n');",
    "console.log('<testsuites><testsuite><testcase name=\"login succeeds\"/></testsuite></testsuites>');",
  ].join("\n"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "ProjectMind Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  await writeFile(join(root, ".projectmind/runtime/lcov.info"), "SF:src/stale.ts\nDA:1,1\nend_of_record\n");
  const record = await collectCommandEvidence(root, { ...config.verification.commands[0]!, command: "node runner.mjs" });
  assert.equal(record.evidenceError, undefined);
  assert.deepEqual(record.coverageSummary?.files, [{ path: "src/auth.ts", linesFound: 1, linesHit: 1 }]);
});

test("explicit coverage binding verifies only when the bound source has executed lines", () => {
  const passing = verifyIntent(config, intent, [evidence(2)], state);
  assert.equal(passing.status, "VERIFIED");

  const unrelated = evidence(2);
  unrelated.coverageSummary = { provider: "lcov", files: [{ path: "src/other.ts", linesFound: 4, linesHit: 4 }] };
  const missing = verifyIntent(config, intent, [unrelated], state);
  assert.equal(missing.status, "NOT_VERIFIED");
  assert.match(missing.reasons.join(" "), /coverage path has no executed lines/);

  const zero = verifyIntent(config, intent, [evidence(0)], state);
  assert.equal(zero.status, "NOT_VERIFIED");
});
