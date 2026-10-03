# Contributing

Requires Node 22.18+ and pnpm 11.25.0.

```bash
git clone https://github.com/callabens/ProjectMind.git
cd ProjectMind
pnpm install --frozen-lockfile
pnpm validate
```

Read [architecture](docs/ARCHITECTURE.md) and [verification semantics](docs/VERIFICATION.md) before changing the trust model. Tests use isolated temporary Git repositories and real command execution. Add a behavioral regression for a bypass/failure case; do not substitute a command that exits 0 for a real test when demonstrating verification.

Good first contributions include a focused fixture, parser regression, package-manager detector or documentation improvement. Provider contributions must use the reviewed [Provider SDK v1](docs/PROVIDERS.md), declare every command explicitly and include fail-closed regression coverage.

For every issue/PR, describe the problem, involved files, expected behavior, acceptance tests and documentation changes. Use conventional commit titles. The maintainer reviews correctness, scope and trust-model changes before merge. Large changes need an RFC under `docs/rfcs/` before implementation.

Run `pnpm validate`. Build/distribution changes additionally require `pnpm pack:check` and `node scripts/package-smoke.mjs ../projectmind-preview.tgz`. Schema changes must regenerate and commit the matching schema. Never add secrets, raw test credentials or unreviewed generated ProofPacks to the repository.

GitHub Actions tests Node 22 and 24 on Linux, the full suite on macOS, and the documented portable subset on Windows. Additional support must be established by tests rather than assumed; see [platform support](docs/PLATFORMS.md).
