# VS Code / GitHub Copilot integration

Install the published ProjectMind CLI, then create or safely extend the repository-scoped VS Code MCP configuration:

```bash
projectmind integration init vscode
```

This writes `.vscode/mcp.json`, preserves unrelated settings and existing servers, and refuses to replace an existing `servers.projectmind` entry. Execution remains disabled.

To inspect the generated object without writing a file:

```bash
projectmind integration config vscode
```

Open GitHub Copilot Chat in Agent mode, enable `projectmind` in the tools picker, and start a fresh chat. ProjectMind runs from the workspace directory and exposes read-only tools unless an operator explicitly enables execution.


Validate the checked-in configuration without launching any process:

```bash
projectmind integration check vscode
```
