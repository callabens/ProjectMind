# Online MCP

ProjectMind supports MCP over Streamable HTTP for web clients such as Claude custom connectors. The existing stdio transport remains available for local agents.

## Start a read-only server

From an initialized repository:

```bash
projectmind mcp-http --host 0.0.0.0 --port 3000
```

The endpoints are:

- `GET /health` for deployment health checks
- `POST /mcp` for stateless MCP Streamable HTTP

Put the service behind HTTPS, then enter `https://your-host.example/mcp` as the custom connector URL. Public servers are read-only by default: verification execution, memory writes, and claim writes remain blocked.

This repository also includes a Vercel function, `vercel.json`, and a minimal `public` status page. Import the GitHub repository into Vercel with the repository root as the project root; the resulting deployment exposes `/mcp` and `/health` without requiring a separate web framework.

## Private writable server

Set a strong secret and enable only the capability you need:

```bash
PROJECTMIND_MCP_TOKEN="replace-with-a-long-random-secret" \
PROJECTMIND_ALLOW_MUTATIONS=1 \
projectmind mcp-http --host 0.0.0.0 --port 3000
```

Clients must send `Authorization: Bearer <token>`. Verification commands remain disabled unless `PROJECTMIND_ALLOW_EXECUTION=1` is also set. ProjectMind refuses to expose execution or mutations on a non-loopback interface without a token.

## Hosting model

An HTTP server operates on the repository checkout supplied through its working directory or `CLAUDE_PROJECT_DIR`. A public demo should use a disposable, read-only checkout. A multi-tenant hosted product needs isolated per-user checkouts and an OAuth-capable gateway; this transport intentionally does not pretend that one shared checkout is multi-tenant isolation.

TLS termination, process supervision, repository refresh, rate limiting, and OAuth are deployment responsibilities. Do not expose an execution-enabled server directly to the public internet.
