import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createIntentFromTemplate, listIntentTemplates } from "../packages/intent/src/templates.ts";

const exec = promisify(execFile);
const cli = resolve("apps/cli/src/index.ts");

test("intent templates are deterministic copies with explicit evidence kinds", () => {
  const first = listIntentTemplates();
  const second = listIntentTemplates();
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((item) => item.id), ["authentication-regression", "api-contract", "dependency-boundary"]);
  first[0]!.requirements.push("mutation");
  assert.notDeepEqual(first, listIntentTemplates());
  assert.ok(second.every((item) => item.requirements.length > 1 && item.preserve.length && item.outOfScope.length));
});

test("template creation preserves defaults and appends explicit project scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-intent-template-"));
  const intent = await createIntentFromTemplate(root, "api-contract", {
    title: "Keep payments API compatible",
    requirements: ["Idempotency keys remain supported"],
    preserve: ["Payment retry semantics"],
    outOfScope: ["Checkout visual design"],
  });
  assert.equal(intent.title, "Keep payments API compatible");
  assert.equal(intent.requirements.length, 4);
  assert.ok(intent.requirements.every((item) => item.evidenceKinds.includes("test") && item.evidenceCommands?.length === 0));
  assert.ok(intent.preserve.includes("Published request and response compatibility"));
  assert.ok(intent.preserve.includes("Payment retry semantics"));
  assert.ok(intent.outOfScope.includes("Checkout visual design"));
  await assert.rejects(createIntentFromTemplate(root, "unknown"), /Unknown intent template/);
});

test("CLI lists templates and creates one without requiring a title", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-intent-template-"));
  const listed = await exec(process.execPath, ["--experimental-strip-types", cli, "intent", "templates", "--json"], { cwd: root });
  assert.equal((JSON.parse(listed.stdout) as Array<{ id: string }>)[0]?.id, "authentication-regression");
  const created = await exec(process.execPath, ["--experimental-strip-types", cli, "intent", "create", "--template", "dependency-boundary"], { cwd: root });
  assert.match(created.stdout, /Preserve architecture dependency boundaries/);
  assert.match(created.stdout, /REQ-2/);
});
