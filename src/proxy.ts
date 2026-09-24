import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ContentBlock,
} from "@modelcontextprotocol/sdk/types.js";

import { Deduplicator } from "./dedup.js";
import { SessionStats } from "./stats.js";
import { squeezeContent, type SqueezeOptions } from "./squeeze.js";

export interface RunProxyOptions extends SqueezeOptions {
  /** The command used to launch the real, underlying MCP server (e.g. "node"). */
  command: string;
  /** Arguments for that command (e.g. ["real-server.js"]). */
  args: string[];
}

export interface ProxySession {
  stats: SessionStats;
  /** Cleanly shuts down both the facade server and the upstream client connection. */
  close(): Promise<void>;
}

const PACKAGE_NAME = "mcpsqueeze";
const PACKAGE_VERSION = "0.1.0";

/**
 * Starts MCP Squeeze: spawns the wrapped ("upstream") MCP server as a child
 * process and connects to it as a real MCP client over stdio, then exposes a
 * real MCP server facade over *this* process's own stdio for the agent
 * client to connect to. Every request from the agent is forwarded to the
 * upstream server; tool-call results are deduplicated/truncated on the way
 * back.
 */
export async function startProxy(options: RunProxyOptions): Promise<ProxySession> {
  const stats = new SessionStats();
  const dedup = new Deduplicator();
  let callCounter = 0;

  const upstreamTransport = new StdioClientTransport({
    command: options.command,
    args: options.args,
    stderr: "inherit",
  });

  const upstreamClient = new Client(
    { name: `${PACKAGE_NAME}-upstream-client`, version: PACKAGE_VERSION },
    { capabilities: {} },
  );

  await upstreamClient.connect(upstreamTransport);

  const upstreamCaps = upstreamClient.getServerCapabilities() ?? {};

  const facade = new Server(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    {
      capabilities: {
        ...(upstreamCaps.tools ? { tools: upstreamCaps.tools } : {}),
        ...(upstreamCaps.prompts ? { prompts: upstreamCaps.prompts } : {}),
        ...(upstreamCaps.resources ? { resources: upstreamCaps.resources } : {}),
        ...(upstreamCaps.logging ? { logging: upstreamCaps.logging } : {}),
      },
    },
  );

  if (upstreamCaps.tools) {
    facade.setRequestHandler(ListToolsRequestSchema, async (request) => {
      return upstreamClient.listTools(request.params);
    });

    facade.setRequestHandler(CallToolRequestSchema, async (request) => {
      callCounter += 1;
      const callIndex = callCounter;
      const toolName = request.params.name;

      const upstreamResult = (await upstreamClient.callTool(request.params)) as CallToolResult;
      const originalContent = (upstreamResult.content ?? []) as ContentBlock[];

      const { content, record } = squeezeContent(originalContent, callIndex, dedup, {
        truncateChars: options.truncateChars,
      });

      stats.record({ index: callIndex, toolName, ...record });

      return { ...upstreamResult, content };
    });
  }

  if (upstreamCaps.prompts) {
    facade.setRequestHandler(ListPromptsRequestSchema, async (request) => {
      return upstreamClient.listPrompts(request.params);
    });
    facade.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return upstreamClient.getPrompt(request.params);
    });
  }

  if (upstreamCaps.resources) {
    facade.setRequestHandler(ListResourcesRequestSchema, async (request) => {
      return upstreamClient.listResources(request.params);
    });
    facade.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
      return upstreamClient.listResourceTemplates(request.params);
    });
    facade.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return upstreamClient.readResource(request.params);
    });
  }

  const facadeTransport = new StdioServerTransport();
  await facade.connect(facadeTransport);

  return {
    stats,
    async close() {
      await facade.close();
      await upstreamClient.close();
    },
  };
}
