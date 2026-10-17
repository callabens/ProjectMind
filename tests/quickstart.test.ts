import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const cli = resolve("apps/cli/src/index.ts");

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "projectmind-quickstart-"));
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "quickstart-fixture",
    type: "module",
    scripts: { test: "node marker-test.js" },
  }));
  await writeFile(join(root, "marker-test.js"), "await import('node:fs/promises').then(({ writeFile }) => writeFile('executed.txt', 'yes'));\n");
  await writeFile(join(root, "index.ts"), "export const value = 1;\n");
  return root;
}

test("quickstart initializes, scans and creates a template without executing project commands", async () => {
  const root = await project();
  const { stdout } = await exec(process.execPath, ["--experimental-strip-types", cli, "quickstart", "--template", "api-contract", "--title", "Keep fixture API stable"], { cwd: root });
  assert.match(stdout, /ProjectMind/);
  assert.match(stdout, /Keep fixture API stable/);
  assert.match(stdout, /No verification commands were executed/);
  await assert.rejects(access(join(root, "executed.txt")));
  await assert.rejects(access(join(root, ".projectmind", "latest-proof.json")));
  const current = JSON.parse(await readFile(join(root, ".projectmind", "current-intent.json"), "utf8")) as { id: string };
  assert.equal(current.id, "PM-0001");
});

test("quickstart validates templates before mutation and never replaces an active intent", async () => {
  const unknownRoot = await project();
  await assert.rejects(exec(process.execPath, ["--experimental-strip-types", cli, "quickstart", "--template", "unknown"], { cwd: unknownRoot }), /Unknown intent template/);
  await assert.rejects(access(join(unknownRoot, ".projectmind")));

  const root = await project();
  await exec(process.execPath, ["--experimental-strip-types", cli, "quickstart", "--template", "authentication-regression"], { cwd: root });
  const before = await readFile(join(root, ".projectmind", "current-intent.json"), "utf8");
  await assert.rejects(exec(process.execPath, ["--experimental-strip-types", cli, "quickstart", "--template", "api-contract"], { cwd: root }), /will not replace/);
  assert.equal(await readFile(join(root, ".projectmind", "current-intent.json"), "utf8"), before);
});
