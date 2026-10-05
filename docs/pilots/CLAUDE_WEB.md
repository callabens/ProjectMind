# Claude Web custom connector pilot

Date: 2026-10-05

This pilot exercised ProjectMind through Claude Web's custom connector interface using the public read-only Streamable HTTP deployment at `https://projectmind-tau.vercel.app/mcp`.

## Observed compatibility

- Claude connected successfully without a local terminal or Claude Code installation.
- The client discovered all ten ProjectMind tools.
- `projectmind_get_project_context` returned the deployed ProjectMind checkout and graph summary.
- Intent, constraints, changed-symbol and claim-report reads completed successfully.
- The clean deployment checkout reported no working-tree changes.
- Execution remained disabled and verification could not be requested without explicit operator opt-in.
- Repository mutation tools remained server-side blocked in the public deployment.
- An absent deployment-local ProofPack was honestly reported rather than converted into a verdict.

## Pilot result

The online transport is compatible with Claude Web custom connectors for safe read-only project inspection. It does not claim multi-tenant repository isolation, OAuth, or remote command execution. The separate authenticated Claude Code stdio pilot remains tracked independently because a web connector session is not equivalent to Claude Code.

No credentials, private repository content, or authentication material are included in this record.
