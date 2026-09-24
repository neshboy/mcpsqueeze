#!/usr/bin/env node
// A small, real MCP server used only as a test fixture for MCP Squeeze.
// It speaks the real MCP protocol over stdio via the official SDK - it is
// not part of the shipped product, just something for the proxy to wrap.
//
// Plain JS (not TS) on purpose: it is spawned directly as a child process
// by the test suite and by manual smoke tests, with no build step needed.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Deterministic, comfortably-oversized blob (5640 chars) so tests can rely
// on it always exceeding the default 2000-char truncation threshold.
export const LARGE_TEXT = "The quick brown fox jumps over the lazy dog. ".repeat(120);

const server = new Server(
  { name: "mcpsqueeze-test-fixture", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echoes back the provided message, unmodified.",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
    {
      name: "get_large_text",
      description: "Returns a large deterministic block of text (always the same), for testing truncation.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "echo") {
    const message = typeof args?.message === "string" ? args.message : "";
    return { content: [{ type: "text", text: message }] };
  }

  if (name === "get_large_text") {
    return { content: [{ type: "text", text: LARGE_TEXT }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
