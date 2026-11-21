import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { PROJECTMIND_VERSION } from "../packages/core/src/index.ts";

const exec = promisify(execFile);
const cli = resolve("apps/cli/src/index.ts");

async function run(args: string[]): Promise<string> {
  const { stdout } = await exec(process.execPath, ["--experimental-strip-types", cli, ...args]);
  return stdout.trim();
}

test("CLI reports the package version through standard flags", async () => {
  assert.equal(await run(["--version"]), PROJECTMIND_VERSION);
  assert.equal(await run(["-v"]), PROJECTMIND_VERSION);
  assert.equal(await run(["version"]), PROJECTMIND_VERSION);
});
