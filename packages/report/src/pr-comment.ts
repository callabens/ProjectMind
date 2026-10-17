import { proofPackSchema } from "../../core/src/schema.ts";
import { diffProofPacks, type ProofPackRequirementState } from "../../proofpack/src/index.ts";

const MARKER = "<!-- projectmind-verification -->";
const MAX_REQUIREMENTS = 50;
const MAX_REASONS = 10;
const MAX_DIFFS = 20;

function statusRank(status: ProofPackRequirementState): number {
  if (status === "VERIFIED") return 3;
  if (status === "UNVERIFIED") return 2;
  if (status === "FAILED") return 1;
  return 0;
}

function safe(value: string, limit = 500): string {
  const bounded = value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
  return bounded
    .replaceAll("@", "@\u200b")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/g, " ");
}

export function formatPullRequestComment(input: unknown, previousInput?: unknown): string {
  const proof = proofPackSchema.parse(input);
  const status = proof.verification.status;
  const icon = status === "VERIFIED" ? "✅" : "⚠️";
  const results = new Map(proof.verification.requirements.map((item) => [item.requirementId, item]));
  const requirements = proof.intent.requirements.slice(0, MAX_REQUIREMENTS);
  const lines = [
    MARKER,
    `## ${icon} ProjectMind: ${status === "VERIFIED" ? "VERIFIED" : "NOT VERIFIED"}`,
    "",
    `Intent: **${safe(proof.intent.id)} — ${safe(proof.intent.title)}**`,
    "",
    "| Requirement | Status | Bound evidence | Coverage paths |",
    "| --- | --- | ---: | --- |",
    ...requirements.map((requirement) => {
      const result = results.get(requirement.id);
      const resultStatus = result?.status ?? "UNVERIFIED";
      const resultIcon = resultStatus === "VERIFIED" ? "✅" : resultStatus === "FAILED" ? "❌" : "⚠️";
      const coverage = requirement.coveragePaths?.length ? requirement.coveragePaths.map((path) => {
        const hit = proof.evidence.some((record) => result?.evidenceIds.includes(record.id)
          && record.coverageSummary?.files.some((file) => file.path === path && file.linesHit > 0));
        return `${hit ? "✅" : "⚠️"} ${safe(path)}`;
      }).join("<br>") : "—";
      return `| ${safe(requirement.id)} — ${safe(requirement.statement)} | ${resultIcon} ${resultStatus} | ${result?.evidenceIds.length ?? 0} | ${coverage} |`;
    }),
  ];
  if (proof.intent.requirements.length > MAX_REQUIREMENTS) lines.push("", `_Only the first ${MAX_REQUIREMENTS} requirements are shown._`);
  if (proof.verification.reasons.length) lines.push(
    "",
    "<details><summary>Why verification did not pass</summary>",
    "",
    ...proof.verification.reasons.slice(0, MAX_REASONS).map((reason) => `- ${safe(reason)}`),
    ...(proof.verification.reasons.length > MAX_REASONS ? [`- …and ${proof.verification.reasons.length - MAX_REASONS} more`] : []),
    "",
    "</details>",
  );
  if (previousInput !== undefined) {
    const diff = diffProofPacks(previousInput, proof);
    const changed = diff.requirements.filter((item) => item.change !== "UNCHANGED").slice(0, MAX_DIFFS);
    lines.push(
      "",
      "### Change since previous ProofPack",
      "",
      `Verdict: **${safe(diff.before.status)} → ${safe(diff.after.status)}**`,
      `Requirements: ${diff.summary.added} added · ${diff.summary.removed} removed · ${diff.summary.changed} changed · ${diff.summary.unchanged} unchanged`,
    );
    if (changed.length) lines.push(
      "",
      "| Change | Requirement | Before | After |",
      "| --- | --- | --- | --- |",
      ...changed.map((item) => {
        const direction = item.change === "ADDED" ? "➕ ADDED"
          : item.change === "REMOVED" ? "➖ REMOVED"
            : statusRank(item.after) < statusRank(item.before) ? "🔻 REGRESSION"
              : statusRank(item.after) > statusRank(item.before) ? "🔺 IMPROVEMENT"
                : "✏️ CHANGED";
        return `| ${direction} | ${safe(item.requirementId)} | ${safe(item.before)} | ${safe(item.after)} |`;
      }),
      ...(diff.requirements.filter((item) => item.change !== "UNCHANGED").length > MAX_DIFFS ? ["", `_Only the first ${MAX_DIFFS} requirement changes are shown._`] : []),
    );
  }
  lines.push(
    "",
    `ProofPack: \`${safe(proof.id)}\` · commit \`${safe(proof.commit ?? "working-tree")}\` · ${safe(proof.createdAt)}`,
    "",
    "> This reports declared-command evidence for one recorded repository state. It is not a general correctness or security guarantee.",
  );
  return lines.join("\n");
}

export const pullRequestCommentMarker = MARKER;
