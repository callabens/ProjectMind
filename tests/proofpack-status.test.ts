import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initializeProject } from "../packages/core/src/project.ts";
import { projectMindDir } from "../packages/core/src/index.ts";
import { repositoryState } from "../packages/git/src/index.ts";
import { getHistoricalProofStatus, getHistoricalVerificationFeedback } from "../packages/proofpack/src/index.ts";

const exec = promisify(execFile);
const cli = resolve("apps/cli/src/index.ts");

test("historical ProofPack status distinguishes absent, matching, stale, and invalid artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-proof-status-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "proof-status", type: "module" }));
  await writeFile(join(root, "src/index.ts"), "export const value = 1;\n");
  await exec("git", ["init", "-q"], { cwd: root });
  await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["-c", "user.name=ProjectMind Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], { cwd: root });
  await initializeProject(root);

  assert.equal((await getHistoricalProofStatus(root)).status, "NOT_AVAILABLE");
  assert.match((await getHistoricalVerificationFeedback(root)).nextAction, /first ProofPack/);
  const state = await repositoryState(root);
  const proof = JSON.parse(await readFile(resolve("fixtures/proofpack-v1/valid.json"), "utf8"));
  proof.verification.repositoryState = state;
  for (const evidence of proof.evidence) {
    evidence.repositoryState = state;
    evidence.repositoryStateAfter = state;
  }
  await writeFile(join(projectMindDir(root), "latest-proof.json"), `${JSON.stringify(proof, null, 2)}\n`);

  const matching = await getHistoricalProofStatus(root);
  assert.equal(matching.status, "MATCHING_REPOSITORY_STATE");
  assert.equal(matching.recordedVerdict, "VERIFIED");
  const { stdout } = await exec(process.execPath, ["--experimental-strip-types", cli, "proof", "status", "--json"], { cwd: root });
  assert.equal(JSON.parse(stdout).status, "MATCHING_REPOSITORY_STATE");
  const feedback = await getHistoricalVerificationFeedback(root);
  assert.equal(feedback.status, "MATCHING_REPOSITORY_STATE");
  assert.equal(feedback.requirements[0]?.statement, proof.intent.requirements[0].statement);
  const feedbackCli = await exec(process.execPath, ["--experimental-strip-types", cli, "proof", "feedback", "--json"], { cwd: root });
  assert.equal(JSON.parse(feedbackCli.stdout).recordedVerdict, "VERIFIED");

  await writeFile(join(root, "src/index.ts"), "export const value = 2;\n");
  assert.equal((await getHistoricalProofStatus(root)).status, "STALE");
  assert.match((await getHistoricalVerificationFeedback(root)).nextAction, /run fresh verification/);
  await assert.rejects(exec(process.execPath, ["--experimental-strip-types", cli, "proof", "status"], { cwd: root }), (error: unknown) => {
    assert.match(String((error as { stdout?: string }).stdout), /Historical ProofPack: STALE/);
    return (error as { code?: number }).code === 2;
  });

  await writeFile(join(projectMindDir(root), "latest-proof.json"), "{}\n");
  assert.equal((await getHistoricalProofStatus(root)).status, "INVALID_ARTIFACT");
  assert.equal((await getHistoricalVerificationFeedback(root)).status, "INVALID_ARTIFACT");
});
