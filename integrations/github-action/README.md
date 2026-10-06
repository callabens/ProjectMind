# GitHub Action

The composite action lives at the repository root. Replace `<reviewed-commit-sha>` with a reviewed full commit SHA before use; no stable action tag exists yet.

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  - uses: callabens/ProjectMind@<reviewed-commit-sha>
    with:
      intent-id: PM-0001
      trust-repository-code: 'true'
```

Commit reviewed `.projectmind/config.json`, intent contracts, and the current-intent pointer in the target repository. The target's own dependencies must be installed separately. The action installs only ProjectMind's dependencies, runs fresh verification, fails the check on missing/failed evidence, writes a step summary, and uploads an unsigned ProofPack artifact.

Use `base-ref` for committed-change comparison and `working-directory` for a nested independent Git repository. Input values pass through environment variables and quoted shell arrays. The workflow must have read-only permissions; never run untrusted PR code with production secrets or `pull_request_target`.

## Safe PR comments

Use the repository's [workflow-run reporter example](../../.github/workflows/projectmind-pr-comment.yml) as the template. The verification workflow keeps `contents: read`, runs repository code without a write token, and uploads the raw ProofPack. A separate `workflow_run` job checks out only the trusted default branch, downloads that artifact, validates it, renders a bounded comment, and receives only `actions: read`, `contents: read`, and `pull-requests: write`.

Do not add `pull-requests: write` to the workflow that executes PR code, and do not use `pull_request_target` to execute the PR checkout. The reporter updates one marker comment instead of creating a new comment for every run. Invalid ProofPacks fail before a comment is posted.
