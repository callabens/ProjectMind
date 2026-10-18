# Cursor integration

Install the published ProjectMind CLI, then create or safely extend the repository-scoped Cursor configuration:

```bash
projectmind integration init cursor
```

This writes `.cursor/mcp.json`, preserves unrelated top-level settings and MCP servers, and refuses to replace an existing `projectmind` entry. Command execution starts disabled. Review the generated JSON before Cursor approves or launches the server.

To inspect the generated object without writing a file:

```bash
projectmind integration config cursor
```

The configuration follows Cursor's project-level `mcp.json` stdio format. ProjectMind runs with the workspace as its current directory, exposes read-only tools by default, and does not require a model API key.
