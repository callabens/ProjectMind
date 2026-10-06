import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initializeProject, loadConfig } from "../packages/core/src/project.ts";
import { buildMindGraph, persistMindGraph } from "../packages/graph/src/index.ts";
import { createIntent, bindRequirement, loadIntent, suggestRequirementBindings } from "../packages/intent/src/index.ts";
import { collectVerificationEvidence } from "../packages/evidence/src/index.ts";
import { verifyIntent } from "../packages/verifier/src/index.ts";
import { summarizeChanges, repositoryState } from "../packages/git/src/index.ts";
import { createProofPack } from "../packages/proofpack/src/index.ts";
import { diagnoseProject } from "../packages/doctor/src/index.ts";

const execFileAsync = promisify(execFile);
const cli = resolve("apps/cli/src/index.ts");

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "projectmind-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, "tests/auth.test.js"), `import test from "node:test"; import assert from "node:assert/strict"; import { login } from "../src/auth.ts"; test("login", () => assert.equal(login("demo"), true));`);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "fixture-app",
    type: "module",
    scripts: {
      test: "node --experimental-strip-types --test tests/auth.test.js"
    }
  }, null, 2));
  await writeFile(join(root, "src", "auth.ts"), `export function login(user: string) { return user.length > 0; }\n`);
  await writeFile(join(root, "src", "index.ts"), `import { login } from "./auth.ts";\nexport const run = () => login("demo");\n`);
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "ProjectMind Test"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}

test("initialization builds a usable graph", async () => {
  const root = await fixture();
  const config = await initializeProject(root);
  const graph = await buildMindGraph(root, config);
  await persistMindGraph(root, graph);

  assert.equal(config.project.name, "fixture-app");
  assert.ok(graph.nodes.some((node) => node.type === "FUNCTION" && node.name === "login"));
  assert.ok(graph.edges.some((edge) => edge.type === "IMPORTS"));
});

test("verification derives VERIFIED from passing evidence", async () => {
  const root = await fixture();
  const config = await initializeProject(root);
  const graph = await buildMindGraph(root, config);
  await persistMindGraph(root, graph);
  const intent = await createIntent(root, "Keep authentication working", ["Authentication remains functional"], [], []);
  const evidence = await collectVerificationEvidence(root, config);
  await bindRequirement(root, "REQ-1", config.verification.commands[0]!.command, undefined, ["login"]);
  const bound = await loadIntent(root);
  const freshEvidence = await collectVerificationEvidence(root, config);
  const result = verifyIntent(config, bound, freshEvidence, await repositoryState(root));

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.requirements[0]?.status, "VERIFIED");
});

test("verification refuses missing required evidence", async () => {
  const root = await fixture();
  const config = await initializeProject(root);
  const intent = await createIntent(root, "Runtime behavior is safe", ["Runtime behavior is independently observed"], [], [], ["runtime"]);
  const result = verifyIntent(config, intent, []);

  assert.equal(result.status, "NOT_VERIFIED");
  assert.equal(result.requirements[0]?.status, "UNVERIFIED");
});

test("change summary and ProofPack preserve intent/change/evidence lineage", async () => {
  const root = await fixture();
  const config = await initializeProject(root);
  const graph = await buildMindGraph(root, config);
  await persistMindGraph(root, graph);
  const intent = await createIntent(root, "Change auth", ["Auth behavior has evidence"], [], []);
  await writeFile(join(root, "src", "auth.ts"), `export function login(user: string) { return user.trim().length > 0; }\n`);
  const change = await summarizeChanges(root, graph);
  const evidence = await collectVerificationEvidence(root, config);
  await bindRequirement(root, "REQ-1", config.verification.commands[0]!.command, undefined, ["login"]);
  const bound = await loadIntent(root);
  const freshEvidence = await collectVerificationEvidence(root, config);
  const verification = verifyIntent(config, bound, freshEvidence, await repositoryState(root));
  const proof = await createProofPack(root, config.project.name, bound, change, freshEvidence, verification);

  assert.ok(change.files.includes("src/auth.ts"));
  assert.ok(change.changedSymbols.some((symbol) => symbol.name === "login"));
  assert.equal(proof.intent.id, bound.id);
  assert.equal(proof.verification.status, "VERIFIED");

  const persisted = JSON.parse(await readFile(join(root, ".projectmind", "latest-proof.json"), "utf8")) as { id: string };
  assert.equal(persisted.id, proof.id);
});

test("config can be loaded after initialization", async () => {
  const root = await fixture();
  await initializeProject(root);
  const config = await loadConfig(root);
  assert.equal(config.version, 1);
  assert.ok(config.verification.commands.some((command) => command.kind === "test"));
});

test("CLI reports requirement binding as an update", async () => {
  const root = await fixture();
  const config = await initializeProject(root);
  await createIntent(root, "Keep authentication working", ["Authentication remains functional"], [], []);
  const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", cli, "intent", "bind", "REQ-1", "--command", config.verification.commands[0]!.command, "--test", "login"], { cwd: root });
  assert.match(stdout, /Requirement REQ-1 bound in intent PM-0001/);
  assert.doesNotMatch(stdout, /Intent PM-0001 created/);
});

test("binding suggestions are deterministic, heuristic, and never mutate intent", async () => {
  const root = await fixture();
  await initializeProject(root);
  const intent = await createIntent(root, "Keep authentication working", ["Login remains functional", "Billing remains functional"], [], []);
  const before = JSON.stringify(await loadIntent(root));
  const first = await suggestRequirementBindings(root);
  const second = await suggestRequirementBindings(root);

  assert.deepEqual(first, second);
  assert.equal(first.status, "SUGGESTIONS");
  assert.deepEqual(first.suggestions.map((item) => item.requirementId), ["REQ-1"]);
  assert.equal(first.suggestions[0]?.testName, "login");
  assert.equal(first.suggestions[0]?.confidence, "heuristic");
  assert.ok(first.suggestions[0]?.reasons.some((item) => item.kind === "requirement-token" && item.value === "login"));
  assert.ok(first.diagnostics.includes("REQ-2 has no deterministic candidate."));
  assert.equal(JSON.stringify(await loadIntent(root, intent.id)), before);

  const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", cli, "intent", "suggest", "REQ-1", "--json"], { cwd: root });
  const cliReport = JSON.parse(stdout) as { suggestions: Array<{ testName: string }> };
  assert.equal(cliReport.suggestions[0]?.testName, "login");
});

test("doctor reports setup and binding gaps without producing a verdict", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-doctor-"));
  const missing = await diagnoseProject(root);
  assert.equal(missing.status, "NEEDS_ATTENTION");
  assert.deepEqual(missing.diagnostics.map((item) => item.code), ["NOT_INITIALIZED"]);

  await writeFile(join(root, "package.json"), JSON.stringify({ name: "doctor-example", scripts: { test: "node --test tests/*.test.js" } }));
  await initializeProject(root);
  const intent = await createIntent(root, "Keep login working", ["Login succeeds"], [], []);
  const before = JSON.stringify(await loadIntent(root, intent.id));
  const report = await diagnoseProject(root);
  assert.equal(report.status, "NEEDS_ATTENTION");
  assert.equal(report.projectName, "doctor-example");
  assert.ok(report.diagnostics.some((item) => item.code === "UNBOUND_REQUIREMENT"));
  assert.ok(report.diagnostics.some((item) => item.code === "NO_SCOPE_DECLARATIONS"));
  assert.equal(JSON.stringify(await loadIntent(root, intent.id)), before);
  assert.ok(!("verdict" in report));

  const config = await loadConfig(root);
  await bindRequirement(root, "REQ-1", config.verification.commands[0]!.command, intent.id, ["login succeeds"]);
  const ready = await diagnoseProject(root);
  assert.equal(ready.status, "READY");
  assert.ok(!ready.diagnostics.some((item) => item.severity === "error"));
});
