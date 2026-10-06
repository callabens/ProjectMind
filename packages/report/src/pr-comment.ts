import { proofPackSchema } from "../../core/src/schema.ts";

const MARKER = "<!-- projectmind-verification -->";
const MAX_REQUIREMENTS = 50;
const MAX_REASONS = 10;

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

export function formatPullRequestComment(input: unknown): string {
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
    "| Requirement | Status | Bound evidence |",
    "| --- | --- | ---: |",
    ...requirements.map((requirement) => {
      const result = results.get(requirement.id);
      const resultStatus = result?.status ?? "UNVERIFIED";
      const resultIcon = resultStatus === "VERIFIED" ? "✅" : resultStatus === "FAILED" ? "❌" : "⚠️";
      return `| ${safe(requirement.id)} — ${safe(requirement.statement)} | ${resultIcon} ${resultStatus} | ${result?.evidenceIds.length ?? 0} |`;
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
  lines.push(
    "",
    `ProofPack: \`${safe(proof.id)}\` · commit \`${safe(proof.commit ?? "working-tree")}\` · ${safe(proof.createdAt)}`,
    "",
    "> This reports declared-command evidence for one recorded repository state. It is not a general correctness or security guarantee.",
  );
  return lines.join("\n");
}

export const pullRequestCommentMarker = MARKER;
