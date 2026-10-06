import { intentSchema, intentIdSchema } from "../../core/src/schema.ts";
import { loadConfig } from "../../core/src/project.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { nowIso, projectMindDir, readJson, writeJson, type EvidenceKind, type IntentContract } from "../../core/src/index.ts";
import { buildMindGraph } from "../../graph/src/index.ts";
import { summarizeChanges } from "../../git/src/index.ts";

export interface BindingSuggestionReason {
  kind: "requirement-token" | "changed-test" | "affected-test" | "tested-changed-file";
  value: string;
}

export interface BindingSuggestion {
  requirementId: string;
  command: string;
  testName: string;
  testPath: string;
  score: number;
  confidence: "heuristic";
  reasons: BindingSuggestionReason[];
}

export interface BindingSuggestionReport {
  intentId: string;
  status: "SUGGESTIONS" | "NO_CANDIDATES";
  suggestions: BindingSuggestion[];
  diagnostics: string[];
}

const ignoredWords = new Set(["a", "an", "and", "are", "be", "for", "in", "is", "must", "of", "or", "should", "the", "to", "with"]);

function tokens(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((item) => item.length > 1 && !ignoredWords.has(item)))].sort();
}

async function nextId(root: string): Promise<string> {
  const dir = join(projectMindDir(root), "intents");
  try {
    const files = (await readdir(dir)).filter((name) => /^PM-\d{4}\.json$/.test(name));
    const max = files.reduce((value, name) => Math.max(value, Number(name.slice(3, 7))), 0);
    return `PM-${String(max + 1).padStart(4, "0")}`;
  } catch {
    return "PM-0001";
  }
}

export async function createIntent(
  root: string,
  title: string,
  requirements: string[],
  preserve: string[],
  outOfScope: string[],
  defaultEvidenceKinds: EvidenceKind[] = ["test"],
): Promise<IntentContract> {
  const id = await nextId(root);
  const statements = requirements.length ? requirements : [title];
  const intent: IntentContract = {
    version: 1,
    id,
    title,
    createdAt: nowIso(),
    requirements: statements.map((statement, index) => ({
      id: `REQ-${index + 1}`,
      statement,
      critical: true,
      evidenceKinds: defaultEvidenceKinds,
      evidenceCommands: [],
    })),
    preserve,
    outOfScope,
  };
  intentSchema.parse(intent);
  await writeJson(join(projectMindDir(root), "intents", `${id}.json`), intent);
  await writeJson(join(projectMindDir(root), "current-intent.json"), { id });
  return intent;
}

export async function loadIntent(root: string, id?: string): Promise<IntentContract> {
  let resolved = id;
  if (!resolved) {
    const current = await readJson<{ id: string }>(join(projectMindDir(root), "current-intent.json"));
    resolved = current.id;
  }
  intentIdSchema.parse(resolved);
  return intentSchema.parse(await readJson(join(projectMindDir(root), "intents", `${resolved}.json`))) as IntentContract;
}

export async function bindRequirement(
  root: string,
  requirementId: string,
  command: string,
  id?: string,
  testNames: string[] = [],
  coveragePaths: string[] = [],
): Promise<IntentContract> {
  const config = await loadConfig(root);
  const registered = config.verification.commands.find((item) => item.command === command);
  if (!registered) throw new Error("Command must be declared in .projectmind/config.json before binding.");
  const intent = await loadIntent(root, id);
  const requirement = intent.requirements.find((item) => item.id === requirementId);
  if (!requirement) throw new Error("Unknown requirement id.");
  if (registered.kind === "test" && registered.provider !== "node-test-junit" && registered.provider !== "pytest-junit") {
    throw new Error("Test requirements require a structured test provider.");
  }
  if ((registered.provider === "node-test-junit" || registered.provider === "pytest-junit") && !testNames.length) {
    throw new Error("Bind at least one exact test name with --test.");
  }
  if (coveragePaths.length && !registered.coveragePath) throw new Error("Coverage bindings require a configured coveragePath on the bound command.");
  requirement.evidenceCommands = [...new Set([...(requirement.evidenceCommands ?? []), command])];
  requirement.evidenceTests = [...new Set([...(requirement.evidenceTests ?? []), ...testNames])];
  requirement.coveragePaths = [...new Set([...(requirement.coveragePaths ?? []), ...coveragePaths])];
  intentSchema.parse(intent);
  await writeJson(join(projectMindDir(root), "intents", `${intent.id}.json`), intent);
  return intent;
}

export async function suggestRequirementBindings(root: string, requirementId?: string, id?: string): Promise<BindingSuggestionReport> {
  const [config, intent] = await Promise.all([loadConfig(root), loadIntent(root, id)]);
  const requirements = requirementId ? intent.requirements.filter((item) => item.id === requirementId) : intent.requirements.filter((item) => !(item.evidenceCommands?.length));
  if (requirementId && !requirements.length) throw new Error("Unknown requirement id.");
  const structured = config.verification.commands.filter((item) => item.kind === "test" && (item.provider === "node-test-junit" || item.provider === "pytest-junit"));
  if (!structured.length) return { intentId: intent.id, status: "NO_CANDIDATES", suggestions: [], diagnostics: ["No configured structured test provider can supply exact testcase evidence."] };

  const graph = await buildMindGraph(root, config);
  const changes = await summarizeChanges(root, graph);
  const changed = new Set(changes.files);
  const affected = new Set(changes.affectedFiles);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const testsForChangedFiles = new Set(graph.edges.filter((edge) => edge.type === "TESTED_BY" && changed.has(nodeById.get(edge.from)?.path ?? "")).map((edge) => nodeById.get(edge.to)?.path).filter((path): path is string => Boolean(path)));
  const suggestions: BindingSuggestion[] = [];

  for (const requirement of requirements) {
    const requirementTokens = new Set(tokens(requirement.statement));
    for (const node of graph.nodes.filter((item) => item.type === "TEST" && item.path)) {
      const names = Array.isArray(node.metadata?.testNames) ? node.metadata.testNames.filter((item): item is string => typeof item === "string") : [];
      const commands = structured.filter((item) => item.provider === "pytest-junit" ? node.path?.endsWith(".py") : !node.path?.endsWith(".py"));
      for (const command of commands) for (const testName of names) {
        const reasons: BindingSuggestionReason[] = [];
        let score = 0;
        for (const token of tokens(`${testName} ${node.path}`)) {
          if (requirementTokens.has(token)) {
            score += 20;
            reasons.push({ kind: "requirement-token", value: token });
          }
        }
        if (changed.has(node.path as string)) { score += 12; reasons.push({ kind: "changed-test", value: node.path as string }); }
        if (affected.has(node.path as string)) { score += 8; reasons.push({ kind: "affected-test", value: node.path as string }); }
        if (testsForChangedFiles.has(node.path as string)) { score += 10; reasons.push({ kind: "tested-changed-file", value: node.path as string }); }
        if (!score) continue;
        suggestions.push({ requirementId: requirement.id, command: command.command, testName, testPath: node.path as string, score, confidence: "heuristic", reasons });
      }
    }
  }
  suggestions.sort((a, b) => b.score - a.score || a.requirementId.localeCompare(b.requirementId) || a.testPath.localeCompare(b.testPath) || a.testName.localeCompare(b.testName) || a.command.localeCompare(b.command));
  const limited = requirements.flatMap((requirement) => suggestions.filter((item) => item.requirementId === requirement.id).slice(0, 5));
  const diagnostics = requirements.filter((requirement) => !limited.some((item) => item.requirementId === requirement.id)).map((requirement) => `${requirement.id} has no deterministic candidate.`);
  return { intentId: intent.id, status: limited.length ? "SUGGESTIONS" : "NO_CANDIDATES", suggestions: limited, diagnostics };
}
