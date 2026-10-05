import { isAbsolute, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMcpHttpRequest } from "../packages/mcp/src/index.ts";

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const configuredRoot = process.env.PROJECTMIND_PROJECT_ROOT;
  if (configuredRoot && !isAbsolute(configuredRoot)) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "PROJECTMIND_PROJECT_ROOT must be absolute" }));
    return;
  }
  await handleMcpHttpRequest(resolve(configuredRoot ?? process.cwd()), {
    allowExecution: process.env.PROJECTMIND_ALLOW_EXECUTION === "1",
    allowMutations: process.env.PROJECTMIND_ALLOW_MUTATIONS === "1",
    ...(process.env.PROJECTMIND_MCP_TOKEN ? { authToken: process.env.PROJECTMIND_MCP_TOKEN } : {}),
  }, request, response);
}
