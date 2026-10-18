#!/usr/bin/env node
import { dirname, isAbsolute, join, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { initializeProject, loadConfig } from "../../../packages/core/src/project.ts";
import { buildMindGraph, persistMindGraph } from "../../../packages/graph/src/index.ts";
import { createIntent, bindRequirement, suggestRequirementBindings } from "../../../packages/intent/src/index.ts";
import { createIntentFromTemplate, listIntentTemplates } from "../../../packages/intent/src/templates.ts";
import { summarizeChanges } from "../../../packages/git/src/index.ts";
import { verifyProject } from "../../../packages/verifier/src/project.ts";
import { formatChanges, formatInit, formatIntent, formatVerification } from "../../../packages/report/src/index.ts";
import { runMcpHttpServer, runMcpServer } from "../../../packages/mcp/src/index.ts";
import { recordMemory, searchMemory, type MemoryType } from "../../../packages/memory/src/index.ts";
import { getClaimReport, recordClaim } from "../../../packages/claims/src/index.ts";
import { PROJECTMIND_VERSION } from "../../../packages/core/src/index.ts";
import { diagnoseProject } from "../../../packages/doctor/src/index.ts";
import { formatPullRequestComment } from "../../../packages/report/src/pr-comment.ts";
import { diffProofPacks, getHistoricalProofStatus, getHistoricalVerificationFeedback, listProofPackHistory, validateProofPack } from "../../../packages/proofpack/src/index.ts";
import { scaffoldProvider } from "../../../packages/sdk/src/scaffold.ts";

interface ParsedArgs {
  positionals: string[];
  options: Map<string, string[]>;
}

function parseArgs(input: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string[]>();
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value) continue;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = input[index + 1];
    if (next && !next.startsWith("--")) {
      options.set(key, [...(options.get(key) ?? []), next]);
      index += 1;
    } else {
      options.set(key, ["true"]);
    }
  }
  return { positionals, options };
}

function optionValues(args: ParsedArgs, key: string): string[] {
  return args.options.get(key) ?? [];
}

function help(): string {
  return `ProjectMind v${PROJECTMIND_VERSION}\n\nCommands:\n  init\n  quickstart --template <id> [--title <title>]\n  doctor [--json]\n  scan\n  changes\n  integration init <claude-code|cursor>\n  integration config <claude-code|cursor|generic> [--json]\n  intent templates [--json]\n  intent create [title] [--template <id>] [--require <text>] [--preserve <text>] [--out-of-scope <text>]\n  intent bind <requirement-id> --command <configured-command> [--test <exact-name>] [--covers <source-path>] [--intent <id>]\n  intent suggest [requirement-id] [--intent <id>] [--base <git-ref>] [--json]\n  verify [intent-id] [--base <git-ref>]\n  proof status [--json]\n  proof feedback [--json]\n  proof validate <proof.json> [--json]\n  proof diff <before.json> <after.json> [--json]\n  proof history [--intent <id>] [--limit <1-100>] [--json]\n  provider scaffold <name> --id <reverse-domain-id> [--directory <path>]\n  report pr-comment [proof-path] [--previous <proof-path>] [--output <path>]\n  claim record <text> [--evidence <id>] [--intent <id>] [--requirement <id>]\n  claim report\n  remember <decision|constraint|incident> <text>\n  recall <query> [--type <decision|constraint|incident>] [--limit <1-50>]\n  mcp\n  mcp-http [--host <host>] [--port <port>]\n`;
}

type IntegrationClient = "claude-code" | "cursor" | "generic";

function integrationServer(client: IntegrationClient): Record<string, unknown> {
  return {
    ...(client === "generic" ? {} : { type: "stdio" }),
    command: "projectmind",
    args: ["mcp"],
    env: { PROJECTMIND_ALLOW_EXECUTION: "0" },
    ...(client === "claude-code" ? { timeout: 600000 } : {}),
  };
}

function integrationConfig(client: IntegrationClient): { mcpServers: { projectmind: Record<string, unknown> } } {
  return { mcpServers: { projectmind: integrationServer(client) } };
}

async function installIntegration(root: string, client: Exclude<IntegrationClient, "generic">): Promise<string> {
  const relativePath = client === "claude-code" ? ".mcp.json" : join(".cursor", "mcp.json");
  const path = join(root, relativePath);
  let document: Record<string, unknown> = {};
  if (existsSync(path)) {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${relativePath} must contain a JSON object.`);
    document = parsed as Record<string, unknown>;
  }
  const existingServers = document.mcpServers;
  if (existingServers !== undefined && (!existingServers || typeof existingServers !== "object" || Array.isArray(existingServers))) {
    throw new Error(`${relativePath} mcpServers must be a JSON object.`);
  }
  const mcpServers = { ...((existingServers ?? {}) as Record<string, unknown>) };
  if (mcpServers.projectmind !== undefined) throw new Error(`${relativePath} already defines mcpServers.projectmind; review it manually.`);
  mcpServers.projectmind = integrationServer(client);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ ...document, mcpServers }, null, 2)}\n`, "utf8");
  return relativePath;
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const args = parseArgs(process.argv.slice(2));
  const [command, subcommand, ...rest] = args.positionals;

  if (args.options.has("help") || !command || command === "help" || command === "--help" || command === "-h") {
    console.log(help());
    return;
  }

  if (command === "init") {
    const config = await initializeProject(root);
    const graph = await buildMindGraph(root, config);
    await persistMindGraph(root, graph);
    console.log(formatInit(config, graph));
    return;
  }

  if (command === "quickstart") {
    const templateId = optionValues(args, "template")[0];
    if (!templateId) throw new Error("Usage: projectmind quickstart --template <id> [--title <title>]");
    if (!listIntentTemplates().some((template) => template.id === templateId)) throw new Error(`Unknown intent template: ${templateId}`);
    if (existsSync(join(root, ".projectmind", "current-intent.json"))) throw new Error("Quickstart will not replace an existing active intent. Use intent create explicitly.");
    const config = await initializeProject(root);
    const graph = await buildMindGraph(root, config);
    await persistMindGraph(root, graph);
    const title = optionValues(args, "title")[0];
    const intent = await createIntentFromTemplate(root, templateId, { ...(title ? { title } : {}) });
    console.log([
      formatInit(config, graph),
      "",
      formatIntent(intent),
      "",
      "No verification commands were executed.",
      "Next: review .projectmind/config.json, then run projectmind intent suggest.",
    ].join("\n"));
    return;
  }

  if (command === "doctor") {
    const report = await diagnoseProject(root);
    if (args.options.has("json")) console.log(JSON.stringify(report, null, 2));
    else console.log([
      `ProjectMind doctor: ${report.status}`,
      `Project: ${report.projectName ?? "unknown"}`,
      `Intent: ${report.intentId ?? "none"}`,
      "",
      ...(report.diagnostics.length ? report.diagnostics.map((item) => `${item.severity.toUpperCase()} ${item.code}: ${item.message}${item.remedy ? `\n  ${item.remedy}` : ""}`) : ["No configuration or binding problems found."]),
    ].join("\n"));
    if (report.status !== "READY") process.exitCode = 2;
    return;
  }

  if (command === "integration" && subcommand === "config") {
    const client = rest[0];
    if (client !== "claude-code" && client !== "cursor" && client !== "generic") throw new Error("Usage: projectmind integration config <claude-code|cursor|generic> [--json]");
    const config = integrationConfig(client);
    console.log(args.options.has("json") ? JSON.stringify(config) : JSON.stringify(config, null, 2));
    return;
  }

  if (command === "integration" && subcommand === "init") {
    const client = rest[0];
    if (client !== "claude-code" && client !== "cursor") throw new Error("Usage: projectmind integration init <claude-code|cursor>");
    const path = await installIntegration(root, client);
    console.log(`Configured ProjectMind for ${client} in ${path}. Execution remains disabled.`);
    return;
  }

  if (command === "scan") {
    const config = await loadConfig(root);
    const graph = await buildMindGraph(root, config);
    await persistMindGraph(root, graph);
    const files = graph.nodes.filter((node) => node.type === "FILE" || node.type === "TEST").length;
    const symbols = graph.nodes.filter((node) => node.type === "FUNCTION" || node.type === "CLASS").length;
    console.log(`Scan complete\n\nFiles: ${files}\nSymbols: ${symbols}\nEdges: ${graph.edges.length}`);
    return;
  }

  if (command === "changes") {
    const graph = await buildMindGraph(root, await loadConfig(root));
    console.log(formatChanges(await summarizeChanges(root, graph, optionValues(args, "base")[0])));
    return;
  }

  if (command === "intent" && subcommand === "create") {
    const title = rest.join(" ").trim();
    const templateId = optionValues(args, "template")[0];
    if (!title && !templateId) throw new Error("Intent title or --template is required.");
    const intent = templateId ? await createIntentFromTemplate(root, templateId, {
      ...(title ? { title } : {}),
      requirements: optionValues(args, "require"),
      preserve: optionValues(args, "preserve"),
      outOfScope: optionValues(args, "out-of-scope"),
    }) : await createIntent(root, title, optionValues(args, "require"), optionValues(args, "preserve"), optionValues(args, "out-of-scope"));
    console.log(formatIntent(intent));
    return;
  }

  if (command === "intent" && subcommand === "templates") {
    const templates = listIntentTemplates();
    if (args.options.has("json")) console.log(JSON.stringify(templates, null, 2));
    else console.log(["Intent templates", "", ...templates.map((template) => `${template.id}\n  ${template.description}\n  ${template.requirements.length} requirements · evidence: ${template.evidenceKinds.join(", ")}`)].join("\n"));
    return;
  }

  if (command === "intent" && subcommand === "bind") {
    const requirementId = rest[0];
    const configuredCommand = optionValues(args, "command")[0];
    if (!requirementId || !configuredCommand) throw new Error("Usage: intent bind REQ-1 --command <configured-command>");
    const intent = await bindRequirement(
      root,
      requirementId,
      configuredCommand,
      optionValues(args, "intent")[0],
      optionValues(args, "test"),
      optionValues(args, "covers"),
    );
    console.log(formatIntent(intent, `Requirement ${requirementId} bound in intent ${intent.id}`));
    return;
  }

  if (command === "intent" && subcommand === "suggest") {
    const report = await suggestRequirementBindings(root, rest[0], optionValues(args, "intent")[0], optionValues(args, "base")[0]);
    if (args.options.has("json")) console.log(JSON.stringify(report, null, 2));
    else console.log(report.suggestions.length ? [
      `Binding suggestions for ${report.intentId} (heuristic; not evidence)`,
      ...report.suggestions.map((item) => `${item.requirementId}  score=${item.score}  ${item.testName}\n  ${item.command}\n  ${item.testPath}\n  ${item.reasons.map((reason) => `${reason.kind}:${reason.value}`).join(", ")}`),
      ...report.diagnostics.map((item) => `Note: ${item}`),
    ].join("\n") : `No binding suggestions for ${report.intentId}.\n${report.diagnostics.join("\n")}`);
    return;
  }

  if (command === "verify") {
    const { intent, evidence, result, proof } = await verifyProject(root, subcommand, optionValues(args, "base")[0]);
    console.log(`${formatVerification(intent, evidence, result)}\n\nProofPack: ${proof.id}`);
    if (result.status !== "VERIFIED") process.exitCode = 2;
    return;
  }

  if (command === "proof" && subcommand === "diff") {
    const [beforePath, afterPath] = rest;
    if (!beforePath || !afterPath) throw new Error("Usage: projectmind proof diff <before.json> <after.json> [--json]");
    const diff = diffProofPacks(
      JSON.parse(await readFile(resolve(root, beforePath), "utf8")),
      JSON.parse(await readFile(resolve(root, afterPath), "utf8")),
    );
    if (args.options.has("json")) console.log(JSON.stringify(diff, null, 2));
    else console.log([
      `ProofPack diff: ${diff.project}`,
      `Verdict: ${diff.before.status} -> ${diff.after.status}${diff.verdictChanged ? " (changed)" : ""}`,
      `Requirements: ${diff.summary.added} added, ${diff.summary.removed} removed, ${diff.summary.changed} changed, ${diff.summary.unchanged} unchanged`,
      "",
      ...diff.requirements.map((item) => `${item.change.padEnd(9)} ${item.requirementId}  ${item.before} -> ${item.after}${item.statementBefore !== item.statementAfter ? "  statement changed" : ""}`),
    ].join("\n"));
    return;
  }

  if (command === "proof" && subcommand === "status") {
    const status = await getHistoricalProofStatus(root);
    if (args.options.has("json")) console.log(JSON.stringify(status, null, 2));
    else if (status.status === "NOT_AVAILABLE" || status.status === "INVALID_ARTIFACT") {
      console.log(`Historical ProofPack: ${status.status}\n${status.reason}`);
    } else console.log([
        `Historical ProofPack: ${status.status}`,
        `Proof: ${status.proofId}`,
        `Intent: ${status.intentId}`,
        `Recorded verdict: ${status.recordedVerdict}`,
        `Created: ${status.createdAt}`,
        "No checks were executed and no verdict was refreshed.",
      ].join("\n"));
    if (status.status !== "MATCHING_REPOSITORY_STATE") process.exitCode = 2;
    return;
  }

  if (command === "proof" && subcommand === "feedback") {
    const feedback = await getHistoricalVerificationFeedback(root);
    if (args.options.has("json")) console.log(JSON.stringify(feedback, null, 2));
    else if (feedback.status === "NOT_AVAILABLE") {
      console.log(`Verification feedback: ${feedback.status}\n${feedback.reason}\nNext: ${feedback.nextAction}`);
    } else if (feedback.status === "INVALID_ARTIFACT") {
      console.log(`Verification feedback: ${feedback.status}\n${feedback.reason}\nNext: ${feedback.nextAction}`);
    } else console.log([
      `Verification feedback: ${feedback.status}`,
      `Recorded verdict: ${feedback.recordedVerdict}`,
      ...feedback.requirements.map((item) => `${item.status.padEnd(10)} ${item.requirementId}  ${item.statement}`),
      ...feedback.reasons.map((reason) => `Reason: ${reason}`),
      `Next: ${feedback.nextAction}`,
      "No checks were executed and no verdict was refreshed.",
    ].join("\n"));
    if (feedback.status !== "MATCHING_REPOSITORY_STATE" || feedback.recordedVerdict !== "VERIFIED") process.exitCode = 2;
    return;
  }

  if (command === "proof" && subcommand === "validate") {
    const proofPath = rest[0];
    if (!proofPath) throw new Error("Usage: projectmind proof validate <proof.json> [--json]");
    const proof = validateProofPack(JSON.parse(await readFile(resolve(root, proofPath), "utf8")));
    const result = {
      valid: true as const,
      version: proof.version,
      proofId: proof.id,
      project: proof.project,
      intentId: proof.intent.id,
      status: proof.verification.status,
      commit: proof.commit ?? null,
      createdAt: proof.createdAt,
      requirements: proof.verification.requirements.length,
      evidence: proof.evidence.length,
    };
    if (args.options.has("json")) console.log(JSON.stringify(result, null, 2));
    else console.log([
      `VALID ProofPack v${result.version}`,
      `Proof: ${result.proofId}`,
      `Project: ${result.project}`,
      `Intent: ${result.intentId}`,
      `Verdict: ${result.status}`,
      `Commit: ${result.commit ?? "working-tree"}`,
      `Requirements: ${result.requirements}`,
      `Evidence records: ${result.evidence}`,
    ].join("\n"));
    return;
  }

  if (command === "proof" && subcommand === "history") {
    const rawLimit = optionValues(args, "limit")[0];
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Proof history limit must be an integer from 1 to 100.");
    const intentId = optionValues(args, "intent")[0];
    const entries = await listProofPackHistory(root, { ...(intentId ? { intentId } : {}), limit });
    if (args.options.has("json")) console.log(JSON.stringify(entries, null, 2));
    else console.log(entries.length ? [
      `ProofPack history (${entries.length})`,
      "",
      ...entries.map((entry) => `${entry.createdAt}  ${entry.status.padEnd(18)} ${entry.intentId}  ${entry.proofId}${entry.commit ? `  ${entry.commit.slice(0, 10)}` : ""}`),
    ].join("\n") : "No ProofPack history found.");
    return;
  }

  if (command === "report" && subcommand === "pr-comment") {
    const proofPath = resolve(root, rest[0] ?? join(".projectmind", "latest-proof.json"));
    const previousPath = optionValues(args, "previous")[0];
    const body = formatPullRequestComment(
      JSON.parse(await readFile(proofPath, "utf8")),
      ...(previousPath ? [JSON.parse(await readFile(resolve(root, previousPath), "utf8"))] : []),
    );
    const output = optionValues(args, "output")[0];
    if (output) await writeFile(resolve(root, output), `${body}\n`, "utf8");
    else console.log(body);
    return;
  }

  if (command === "provider" && subcommand === "scaffold") {
    const name = rest[0];
    const providerId = optionValues(args, "id")[0];
    if (!name || !providerId) throw new Error("Usage: projectmind provider scaffold <name> --id <reverse-domain-id> [--directory <path>]");
    const result = await scaffoldProvider(root, name, providerId, optionValues(args, "directory")[0]);
    console.log([`Provider scaffold created: ${result.directory}`, ...result.files.map((path) => `  ${path}`)].join("\n"));
    return;
  }

  if (command === "remember") {
    const type = subcommand as MemoryType | undefined;
    const text = rest.join(" ").trim();
    if (!type || !["decision", "constraint", "incident"].includes(type) || !text) {
      throw new Error("Usage: projectmind remember <decision|constraint|incident> <text>");
    }
    const item = await recordMemory(root, type, text);
    console.log(`${item.type} recorded: ${item.id}`);
    return;
  }

  if (command === "recall") {
    const query = [subcommand, ...rest].filter(Boolean).join(" ").trim();
    const type = optionValues(args, "type")[0] as MemoryType | undefined;
    if (!query || type && !["decision", "constraint", "incident"].includes(type)) {
      throw new Error("Usage: projectmind recall <query> [--type decision|constraint|incident] [--limit 1-50]");
    }
    const rawLimit = optionValues(args, "limit")[0];
    const limit = rawLimit === undefined ? undefined : Number(rawLimit);
    const results = await searchMemory(root, query, { ...(type ? { type } : {}), ...(limit === undefined ? {} : { limit }) });
    console.log([
      "ENGINEERING MEMORY (declared local records; never verification evidence)",
      `Query: ${query}`,
      `Matches: ${results.length}`,
      "",
      ...results.flatMap(({ item, score, matchedTerms }) => [
        `${item.type.toUpperCase().padEnd(10)} ${item.id}  score=${score}  ${item.createdAt}`,
        `  ${item.text}`,
        `  matched: ${matchedTerms.join(", ")}`,
      ]),
    ].join("\n"));
    return;
  }

  if (command === "claim" && subcommand === "record") {
    const text = rest.join(" ").trim();
    if (!text) throw new Error("Usage: projectmind claim record <text>");
    const claim = await recordClaim(root, text, {
      evidenceIds: optionValues(args, "evidence"),
      ...(optionValues(args, "intent")[0] ? { intentId: optionValues(args, "intent")[0] } : {}),
      ...(optionValues(args, "requirement")[0] ? { requirementId: optionValues(args, "requirement")[0] } : {}),
    });
    console.log(`UNPROVEN claim recorded: ${claim.id}`);
    return;
  }

  if (command === "claim" && subcommand === "report") {
    const report = await getClaimReport(root);
    console.log([
      "CLAIM LINK REPORT (historical; does not set a verdict)",
      report.proofId ? `ProofPack: ${report.proofId}` : "ProofPack: none",
      "",
      ...report.assessments.flatMap((item) => [
        `${item.strength.padEnd(29)} ${item.claim.id}  ${item.claim.text}`,
        `  ${item.reasons.join(" ")}`,
      ]),
    ].join("\n"));
    return;
  }

  if (command === "mcp") {
    if (process.env.CLAUDE_PROJECT_DIR && !isAbsolute(process.env.CLAUDE_PROJECT_DIR)) {
      throw new Error("CLAUDE_PROJECT_DIR must be an absolute path.");
    }
    const mcpRoot = process.env.CLAUDE_PROJECT_DIR ? resolve(process.env.CLAUDE_PROJECT_DIR) : root;
    await runMcpServer(mcpRoot, { allowExecution: process.env.PROJECTMIND_ALLOW_EXECUTION === "1" });
    return;
  }

  if (command === "mcp-http") {
    if (process.env.CLAUDE_PROJECT_DIR && !isAbsolute(process.env.CLAUDE_PROJECT_DIR)) {
      throw new Error("CLAUDE_PROJECT_DIR must be an absolute path.");
    }
    const mcpRoot = process.env.CLAUDE_PROJECT_DIR ? resolve(process.env.CLAUDE_PROJECT_DIR) : root;
    const rawPort = optionValues(args, "port")[0] ?? process.env.PORT ?? "3000";
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("MCP HTTP port must be an integer from 0 to 65535.");
    const host = optionValues(args, "host")[0] ?? process.env.HOST ?? "127.0.0.1";
    const server = await runMcpHttpServer(mcpRoot, {
      host,
      port,
      ...(process.env.PROJECTMIND_MCP_TOKEN ? { authToken: process.env.PROJECTMIND_MCP_TOKEN } : {}),
      allowExecution: process.env.PROJECTMIND_ALLOW_EXECUTION === "1",
      allowMutations: process.env.PROJECTMIND_ALLOW_MUTATIONS === "1",
    });
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    console.log(`ProjectMind MCP HTTP listening at http://${host}:${boundPort}/mcp`);
    return;
  }

  throw new Error(`Unknown command.\n\n${help()}`);
}

main().catch((error) => {
  console.error(`ProjectMind error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
