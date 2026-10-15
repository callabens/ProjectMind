import { join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { PROJECTMIND_VERSION, nowIso, projectMindDir, stableId, writeJson, type ChangeSummary, type EvidenceRecord, type IntentContract, type ProofPack, type VerificationResult } from "../../core/src/index.ts";
import { proofPackSchema } from "../../core/src/schema.ts";

export type ProofPackRequirementState = "VERIFIED" | "UNVERIFIED" | "FAILED" | "ABSENT";

export interface ProofPackRequirementDiff {
  requirementId: string;
  statementBefore?: string;
  statementAfter?: string;
  before: ProofPackRequirementState;
  after: ProofPackRequirementState;
  change: "ADDED" | "REMOVED" | "CHANGED" | "UNCHANGED";
}

export interface ProofPackDiff {
  version: 1;
  project: string;
  before: { proofId: string; commit?: string; status: VerificationResult["status"] };
  after: { proofId: string; commit?: string; status: VerificationResult["status"] };
  verdictChanged: boolean;
  requirements: ProofPackRequirementDiff[];
  summary: { added: number; removed: number; changed: number; unchanged: number };
}

export interface ProofPackHistoryEntry {
  proofId: string;
  createdAt: string;
  project: string;
  intentId: string;
  intentTitle: string;
  status: VerificationResult["status"];
  commit?: string;
  path: string;
}

export function validateProofPack(value: unknown): ProofPack {
  return proofPackSchema.parse(value) as ProofPack;
}

export function diffProofPacks(beforeValue: unknown, afterValue: unknown): ProofPackDiff {
  const before = validateProofPack(beforeValue);
  const after = validateProofPack(afterValue);
  if (before.project !== after.project) {
    throw new Error(`Cannot compare ProofPacks from different projects: ${before.project} and ${after.project}`);
  }
  const beforeResults = new Map(before.verification.requirements.map((item) => [item.requirementId, item.status]));
  const afterResults = new Map(after.verification.requirements.map((item) => [item.requirementId, item.status]));
  const beforeStatements = new Map(before.intent.requirements.map((item) => [item.id, item.statement]));
  const afterStatements = new Map(after.intent.requirements.map((item) => [item.id, item.statement]));
  const ids = [...new Set([...beforeResults.keys(), ...afterResults.keys()])].sort((left, right) => left.localeCompare(right, "en"));
  const requirements = ids.map((requirementId): ProofPackRequirementDiff => {
    const beforeState = beforeResults.get(requirementId) ?? "ABSENT";
    const afterState = afterResults.get(requirementId) ?? "ABSENT";
    const statementBefore = beforeStatements.get(requirementId);
    const statementAfter = afterStatements.get(requirementId);
    const change = beforeState === "ABSENT" ? "ADDED"
      : afterState === "ABSENT" ? "REMOVED"
        : beforeState !== afterState || statementBefore !== statementAfter ? "CHANGED"
          : "UNCHANGED";
    return { requirementId, ...(statementBefore ? { statementBefore } : {}), ...(statementAfter ? { statementAfter } : {}), before: beforeState, after: afterState, change };
  });
  return {
    version: 1,
    project: before.project,
    before: { proofId: before.id, ...(before.commit ? { commit: before.commit } : {}), status: before.verification.status },
    after: { proofId: after.id, ...(after.commit ? { commit: after.commit } : {}), status: after.verification.status },
    verdictChanged: before.verification.status !== after.verification.status,
    requirements,
    summary: {
      added: requirements.filter((item) => item.change === "ADDED").length,
      removed: requirements.filter((item) => item.change === "REMOVED").length,
      changed: requirements.filter((item) => item.change === "CHANGED").length,
      unchanged: requirements.filter((item) => item.change === "UNCHANGED").length,
    },
  };
}

export async function listProofPackHistory(
  root: string,
  options: { intentId?: string; limit?: number } = {},
): Promise<ProofPackHistoryEntry[]> {
  const directory = join(projectMindDir(root), "proofs");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
    const path = join(directory, name);
    const proof = validateProofPack(JSON.parse(await readFile(path, "utf8")));
    return {
      proofId: proof.id,
      createdAt: proof.createdAt,
      project: proof.project,
      intentId: proof.intent.id,
      intentTitle: proof.intent.title,
      status: proof.verification.status,
      ...(proof.commit ? { commit: proof.commit } : {}),
      path,
    } satisfies ProofPackHistoryEntry;
  }));
  const filtered = options.intentId ? entries.filter((entry) => entry.intentId === options.intentId) : entries;
  filtered.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.proofId.localeCompare(right.proofId, "en"));
  return options.limit === undefined ? filtered : filtered.slice(0, options.limit);
}

export async function createProofPack(
  root: string,
  projectName: string,
  intent: IntentContract,
  change: ChangeSummary,
  evidence: EvidenceRecord[],
  verification: VerificationResult,
): Promise<ProofPack> {
  const createdAt = nowIso();
  const proof: ProofPack = {
    version: 1,
    projectMindVersion: PROJECTMIND_VERSION,
    scope: "declared-command-checks",
    id: stableId("proof", `${intent.id}:${change.commit ?? "working-tree"}:${createdAt}`),
    createdAt,
    project: projectName,
    ...(change.commit ? { commit: change.commit } : {}),
    intent,
    change,
    evidence,
    verification,
  };
  validateProofPack(proof);
  const suffix = (change.commit ?? "working-tree").slice(0, 10);
  await writeJson(join(projectMindDir(root), "proofs", `${intent.id}-${suffix}-${proof.id}.json`), proof);
  await writeJson(join(projectMindDir(root), "latest-proof.json"), proof);
  return proof;
}
