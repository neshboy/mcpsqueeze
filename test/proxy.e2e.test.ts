import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";

/**
 * End-to-end test: this spawns the REAL, built MCP Squeeze CLI
 * (dist/cli.js) as a child process via `mcpsqueeze wrap -- node
 * test/fixtures/test-server.mjs`, which in turn spawns the real test fixture
 * MCP server as ITS OWN child process. We then connect to the CLI process as
 * a real MCP client over stdio (exactly as an agent would) and make real
 * tools/list and tools/call requests, asserting on what actually comes back
 * over the wire.
 *
 * Requires `npm run build` to have been run first so dist/cli.js exists.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");
const fixturePath = path.join(__dirname, "fixtures", "test-server.mjs");
const LARGE_TEXT_LENGTH = 5640; // "The quick brown fox jumps over the lazy dog. ".repeat(120).length

function textOf(block: { type: string; text?: string }): string {
  if (block.type !== "text") throw new Error(`expected text block, got ${block.type}`);
  return (block as TextContent).text;
}

describe("mcpsqueeze end-to-end proxy", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let stderrChunks: Buffer[];

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, "wrap", "--", process.execPath, fixturePath],
      stderr: "pipe",
    });

    stderrChunks = [];
    // `stderr` is available synchronously right after construction per the SDK docs.
    transport.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    client = new Client({ name: "test-agent", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
  });

  afterAll(async () => {
    // The last test below may have already closed the client to observe the
    // shutdown summary; closing an already-closed client is a no-op we don't
    // want to fail the suite over.
    try {
      await client.close();
    } catch {
      /* already closed */
    }
  });

  it("lists tools transparently, exactly as declared by the wrapped server", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["echo", "get_large_text"]);
  });

  it("passes a normal, small, unique result through completely unchanged", async () => {
    const message = "hello from a unique test message 12345";
    const result = await client.callTool({ name: "echo", arguments: { message } });
    const content = result.content as { type: string; text?: string }[];
    expect(content).toHaveLength(1);
    expect(textOf(content[0])).toBe(message);
  });

  it("truncates an oversized result with a clear, informative marker", async () => {
    const result = await client.callTool({ name: "get_large_text", arguments: {} });
    const content = result.content as { type: string; text?: string }[];
    const text = textOf(content[0]);

    expect(text.length).toBeLessThan(LARGE_TEXT_LENGTH);
    expect(text).toContain("[...truncated,");
    expect(text).toContain("characters omitted");
    expect(text).toContain("use a more specific query to see more");
  });

  it("deduplicates an identical repeated tool call instead of re-truncating it", async () => {
    // get_large_text is deterministic and was already called once above, so
    // this second, identical call must be replaced with a short reference
    // rather than the full (or even truncated) text.
    const result = await client.callTool({ name: "get_large_text", arguments: {} });
    const content = result.content as { type: string; text?: string }[];
    const text = textOf(content[0]);

    expect(text).toMatch(/identical to result from call #\d+/);
    expect(text).toMatch(/\d+ tokens saved/);
    expect(text).not.toContain("[...truncated,");
    expect(text.length).toBeLessThan(300);
  });

  it("deduplicates identical repeated calls that are too small to truncate but big enough that deduping is worth it", async () => {
    const message =
      "repeat-me-please-this-is-not-truncated-but-it-is-long-enough-that-the-short-dedup-" +
      "reference-message-costs-fewer-tokens-than-resending-the-whole-thing-again-and-again.";
    const first = await client.callTool({ name: "echo", arguments: { message } });
    const second = await client.callTool({ name: "echo", arguments: { message } });

    const firstContent = first.content as { type: string; text?: string }[];
    const secondContent = second.content as { type: string; text?: string }[];

    expect(textOf(firstContent[0])).toBe(message);
    expect(textOf(secondContent[0])).toMatch(/identical to result from call #\d+/);
  });

  it("does not confuse two different calls to the same tool with different arguments", async () => {
    const a = await client.callTool({ name: "echo", arguments: { message: "aaa-unique" } });
    const b = await client.callTool({ name: "echo", arguments: { message: "bbb-unique" } });

    const aContent = a.content as { type: string; text?: string }[];
    const bContent = b.content as { type: string; text?: string }[];

    expect(textOf(aContent[0])).toBe("aaa-unique");
    expect(textOf(bContent[0])).toBe("bbb-unique");
  });

  it("prints a token-savings summary to stderr on shutdown", async () => {
    await client.close();
    // Give the child process's "close" handler a moment to flush stderr.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const stderrText = Buffer.concat(stderrChunks).toString("utf8");
    expect(stderrText).toContain("[mcpsqueeze] session summary");
    expect(stderrText).toMatch(/tokens saved:\s+\d+/);
  });
});
