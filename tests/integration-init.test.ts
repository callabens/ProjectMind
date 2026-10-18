import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const exec = promisify(execFile);
const cli = resolve("apps/cli/src/index.ts");
const run = (root: string, args: string[], env: NodeJS.ProcessEnv = process.env) => exec(process.execPath, ["--experimental-strip-types", cli, ...args], { cwd: root, env });

test("integration config emits deterministic safe MCP configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-integration-"));
  const { stdout } = await run(root, ["integration", "config", "generic", "--json"]);
  assert.deepEqual(JSON.parse(stdout), {
    mcpServers: {
      projectmind: {
        command: "projectmind",
        args: ["mcp"],
        env: { PROJECTMIND_ALLOW_EXECUTION: "0" },
      },
    },
  });
});

test("integration init preserves existing servers and refuses to replace ProjectMind", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-integration-"));
  await mkdir(join(root, ".cursor"));
  await writeFile(join(root, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { existing: { command: "existing" } }, setting: true }));
  const result = await run(root, ["integration", "init", "cursor"]);
  assert.match(result.stdout, /Execution remains disabled/);
  const config = JSON.parse(await readFile(join(root, ".cursor/mcp.json"), "utf8"));
  assert.deepEqual(config.mcpServers.existing, { command: "existing" });
  assert.deepEqual(config.mcpServers.projectmind, {
    type: "stdio",
    command: "projectmind",
    args: ["mcp"],
    env: { PROJECTMIND_ALLOW_EXECUTION: "0" },
  });
  assert.equal(config.setting, true);
  await assert.rejects(run(root, ["integration", "init", "cursor"]), /already defines/);
});

test("Claude Code integration includes the reviewed project timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-integration-"));
  await run(root, ["integration", "init", "claude-code"]);
  const config = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8"));
  assert.equal(config.mcpServers.projectmind.type, "stdio");
  assert.equal(config.mcpServers.projectmind.timeout, 600000);
  assert.equal(config.mcpServers.projectmind.env.PROJECTMIND_ALLOW_EXECUTION, "0");
});

test("Codex integration safely extends project-scoped TOML", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-integration-"));
  await mkdir(join(root, ".codex"));
  await writeFile(join(root, ".codex/config.toml"), "model = \"gpt-5\"\n");
  const result = await run(root, ["integration", "init", "codex"]);
  assert.match(result.stdout, /\.codex\/config\.toml/);
  assert.match(result.stdout, /Execution remains disabled/);
  const config = await readFile(join(root, ".codex/config.toml"), "utf8");
  assert.equal(config, `model = "gpt-5"\n\n[mcp_servers.projectmind]\ncommand = "projectmind"\nargs = ["mcp"]\nenv = { PROJECTMIND_ALLOW_EXECUTION = "0" }\n`);
  await assert.rejects(run(root, ["integration", "init", "codex"]), /already defines/);
});

test("Codex integration config can be inspected without writing", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-integration-"));
  const { stdout } = await run(root, ["integration", "config", "codex", "--json"]);
  assert.deepEqual(JSON.parse(stdout), {
    path: ".codex/config.toml",
    content: `[mcp_servers.projectmind]\ncommand = "projectmind"\nargs = ["mcp"]\nenv = { PROJECTMIND_ALLOW_EXECUTION = "0" }\n`,
  });
  assert.equal(existsSync(join(root, ".codex/config.toml")), false);
});


test("VS Code integration uses the project servers format and preserves settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-integration-"));
  await mkdir(join(root, ".vscode"));
  await writeFile(join(root, ".vscode/mcp.json"), JSON.stringify({ servers: { existing: { type: "http", url: "https://example.test/mcp" } }, inputs: [] }));
  const result = await run(root, ["integration", "init", "vscode"]);
  assert.match(result.stdout, /Execution remains disabled/);
  const config = JSON.parse(await readFile(join(root, ".vscode/mcp.json"), "utf8"));
  assert.deepEqual(config.servers.existing, { type: "http", url: "https://example.test/mcp" });
  assert.deepEqual(config.servers.projectmind, {
    type: "stdio",
    command: "projectmind",
    args: ["mcp"],
    env: { PROJECTMIND_ALLOW_EXECUTION: "0" },
  });
  assert.deepEqual(config.inputs, []);
  await assert.rejects(run(root, ["integration", "init", "vscode"]), /already defines/);
});


test("integration check validates safe configuration and fails closed on drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "projectmind-integration-"));
  await run(root, ["integration", "init", "vscode"]);
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "projectmind"), "test fixture\n");
  const env = { ...process.env, PATH: bin };
  const ready = await run(root, ["integration", "check", "vscode", "--json"], env);
  assert.deepEqual(JSON.parse(ready.stdout), {
    client: "vscode",
    path: ".vscode/mcp.json",
    status: "READY",
    issues: [],
  });
  const configPath = join(root, ".vscode/mcp.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.servers.projectmind.env.PROJECTMIND_ALLOW_EXECUTION = "1";
  await writeFile(configPath, JSON.stringify(config));
  try {
    await run(root, ["integration", "check", "vscode", "--json"], env);
    assert.fail("unsafe integration check should fail");
  } catch (error) {
    const result = error as { code: number; stdout: string };
    assert.equal(result.code, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "NEEDS_ATTENTION");
    assert.deepEqual(report.issues.map((issue: { code: string }) => issue.code), ["EXECUTION_NOT_DISABLED"]);
  }
  config.servers.projectmind.env.PROJECTMIND_ALLOW_EXECUTION = "0";
  await writeFile(configPath, JSON.stringify(config));
  try {
    await run(root, ["integration", "check", "vscode", "--json"], { ...process.env, PATH: "" });
    assert.fail("missing command should fail");
  } catch (error) {
    const report = JSON.parse((error as { stdout: string }).stdout);
    assert.deepEqual(report.issues.map((issue: { code: string }) => issue.code), ["COMMAND_NOT_FOUND"]);
  }
});
