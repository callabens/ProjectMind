# Codex integration

Install the published ProjectMind CLI, then create or safely extend the repository-scoped Codex configuration:

```bash
projectmind integration init codex
```

This writes `.codex/config.toml`, preserves existing settings, and refuses to replace an existing `mcp_servers.projectmind` table. Execution remains disabled. Review the generated configuration before starting Codex.

To inspect the TOML without writing a file:

```bash
projectmind integration config codex
```

The generated entry is equivalent to this native Codex CLI command:

```bash
codex mcp add projectmind --env PROJECTMIND_ALLOW_EXECUTION=0 -- projectmind mcp
codex mcp list
```

Codex CLI and the IDE extension share MCP configuration. The project-scoped file keeps the integration with the repository and ProjectMind exposes read-only tools unless an operator explicitly enables execution.
