# Independent package pilot: airjs

Date: 2026-10-03  
Repository: `broofa/airjs`  
Revision: `2b3e9c1438a9c02c1bd74ee93f25e5b1b16d2fb8` (`2023-08-16`, `typo`)  
License: MIT  
Runtime: Node.js `v24.19.0`, npm `11.9.0`  
ProjectMind: `@callabens/projectmind@0.1.0-dev.1` from the `next` tag  
Package integrity: `sha512-TcroVHPj5TkB1ur/CCwjihcaHC2v6MnoGFbAA5clK/brVQeGz3zFLr47y3+HDyoh37QyPZGev8jUZmMhR1waPQ==`

## Why this repository

`airjs` is a small, independent public JavaScript library that predates ProjectMind and uses Node's built-in test runner. Its single reference-sample test is easy to review, requires no service credentials, and lets the released package exercise structured JUnit evidence without changing the upstream repository's trust model.

## Reproduction

The pilot ran in a disposable clone. These commands contain no credentials or private paths:

```bash
git clone https://github.com/broofa/airjs.git
cd airjs
git checkout 2b3e9c1438a9c02c1bd74ee93f25e5b1b16d2fb8
npm ci --ignore-scripts --no-audit --no-fund
npx --yes @callabens/projectmind@next init
npx --yes @callabens/projectmind@next intent create \
  "Preserve published air calculations" \
  --require "Reference samples remain correct"
```

Initialization detected three source files, two symbols and three graph edges. The generated command was reviewed before execution:

```json
{
  "kind": "test",
  "command": "node --test --test-reporter=junit build/test.js",
  "required": true,
  "provider": "node-test-junit"
}
```

The upstream test produced one JUnit testcase named `samples`.

## Fail-closed result

Before binding the requirement, verification executed the passing test but refused to infer coverage:

```text
Evidence
✓ test  node --test --test-reporter=junit build/test.js (1/1 passed, 0 skipped)

Requirements
? REQ-1  Reference samples remain correct

NOT_VERIFIED
REQ-1: structured test binding is missing, ambiguous, skipped, or failed.
```

The command exited with status `2`. This is the intended fail-closed behavior.

## Explicit binding and verified result

```bash
npx --yes @callabens/projectmind@next intent bind REQ-1 \
  --command "node --test --test-reporter=junit build/test.js" \
  --test "samples"
npx --yes @callabens/projectmind@next verify
```

The second verification returned `VERIFIED`. The sanitized ProofPack inspection confirmed:

- one run id across the evidence set;
- identical repository state before and after execution;
- `REQ-1` was verified by one fresh evidence record;
- scope remained `declared-command-checks`.

No ProjectMind files were committed or proposed upstream.

## Findings

The core package behavior needed no repository-specific workaround. Initialization recognized the portable Node test command, an unbound passing test failed closed, and an exact testcase binding verified normally.

One actionable CLI wording defect was found: `intent bind` prints `Intent PM-0001 created` even though it updates an existing intent. The persisted binding is correct, but the message is ambiguous in operator and automation logs. It is tracked separately in issue #24.

This pilot demonstrates compatibility for this pinned revision only. It is not a usage, adoption, contributor, or general ecosystem-support claim.
