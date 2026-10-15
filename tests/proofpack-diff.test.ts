import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { diffProofPacks } from "../packages/proofpack/src/index.ts";

async function fixture(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(new URL("../fixtures/proofpack-v1/valid.json", import.meta.url), "utf8"));
}

test("ProofPack diff reports deterministic requirement and verdict transitions", async () => {
  const before = await fixture();
  const after = structuredClone(before);
  after.id = "proof_222222222222222222222222";
  after.commit = "2222222222222222222222222222222222222222";
  after.change.commit = after.commit;
  after.verification.status = "NOT_VERIFIED";
  after.verification.reasons = ["Bound evidence is missing."];
  delete after.verification.repositoryState;
  after.verification.requirements[0].status = "UNVERIFIED";
  after.verification.requirements[0].evidenceIds = [];
  const diff = diffProofPacks(before, after);
  assert.equal(diff.verdictChanged, true);
  assert.deepEqual(diff.summary, { added: 0, removed: 0, changed: 1, unchanged: 0 });
  assert.deepEqual(diff.requirements.map((item) => [item.requirementId, item.before, item.after, item.change]), [["REQ-1", "VERIFIED", "UNVERIFIED", "CHANGED"]]);
});

test("ProofPack diff reports added and removed requirements in stable order", async () => {
  const before = await fixture();
  const after = structuredClone(before);
  after.intent.requirements[0].id = "REQ-2";
  after.verification.requirements[0].requirementId = "REQ-2";
  const diff = diffProofPacks(before, after);
  assert.deepEqual(diff.requirements.map((item) => [item.requirementId, item.change]), [["REQ-1", "REMOVED"], ["REQ-2", "ADDED"]]);
});

test("ProofPack diff rejects invalid packs and cross-project comparisons", async () => {
  const before = await fixture();
  assert.throws(() => diffProofPacks({}, before));
  assert.throws(() => diffProofPacks(before, { ...before, project: "other-project" }), /different projects/);
});
