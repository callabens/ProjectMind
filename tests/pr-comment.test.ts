import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatPullRequestComment, pullRequestCommentMarker } from "../packages/report/src/pr-comment.ts";

test("PR comment renders a bounded requirement table and honest scope", async () => {
  const proof = JSON.parse(await readFile("fixtures/proofpack-v1/valid.json", "utf8"));
  const body = formatPullRequestComment(proof);
  assert.match(body, /^<!-- projectmind-verification -->/);
  assert.match(body, /ProjectMind: VERIFIED/);
  assert.match(body, /REQ-1 — Login succeeds/);
  assert.match(body, /Coverage paths/);
  assert.match(body, /declared-command evidence/);
  assert.equal(body.match(new RegExp(pullRequestCommentMarker, "g"))?.length, 1);
});

test("PR comment neutralizes mentions, HTML, table injection, and multiline text", async () => {
  const proof = JSON.parse(await readFile("fixtures/proofpack-v1/valid.json", "utf8"));
  proof.intent.requirements[0].statement = "Ping @everyone | <script>alert(1)</script>\nnext";
  const body = formatPullRequestComment(proof);
  assert.doesNotMatch(body, /@everyone/);
  assert.doesNotMatch(body, /<script>/);
  assert.match(body, /@\u200beveryone/);
  assert.match(body, /\\\|/);
  assert.match(body, /&lt;script&gt;/);
});

test("PR comment rejects malformed or forged ProofPack shapes", () => {
  assert.throws(() => formatPullRequestComment({ verification: { status: "VERIFIED" } }));
});
