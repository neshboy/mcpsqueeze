# MCP Squeeze

A drop-in proxy for [MCP](https://modelcontextprotocol.io) (Model Context Protocol) servers that **deduplicates and truncates large or repeated tool-call results** before they reach your agent — and tells you exactly how many tokens it saved.

## Why

MCP tool servers routinely return huge, repetitive payloads: a search tool returns the same 10KB result twice in one session, a file-read tool returns the same file three times because the agent forgot it already read it, a database query returns 500 rows of near-identical JSON. Every one of those bytes gets tokenized and re-sent to the model on every subsequent turn, since most agent loops keep the full conversation (including past tool results) in context. This is a real, widely-felt cost problem for anyone running agents against MCP tools: it burns context window, burns latency, and burns money — all for information the model has often already seen.

MCP Squeeze sits between your agent client and any existing MCP server as a transparent man-in-the-middle proxy. It doesn't change what tools exist or what they do — it only intervenes on the *results* coming back, replacing exact repeats with a short pointer and clipping oversized text with a clearly labeled marker, so the underlying data is never silently dropped.

## How it works

MCP Squeeze speaks real MCP on both sides:

- **Downstream (facade):** it runs a real MCP server (using the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)) over stdio, which is what your agent's MCP client connects to.
- **Upstream (client):** it spawns your real, original MCP server as a child process and connects to it as a real MCP client, also over stdio.

Every request from the agent (`tools/list`, `tools/call`, `prompts/*`, `resources/*`) is forwarded to the real server and the response forwarded back — the proxy is invisible for anything it doesn't need to touch. The one place it intervenes is `tools/call` results:

1. **Dedup** — each result's content is hashed (SHA-256). If the exact same content was already returned earlier in the session, it's replaced with a short reference like `identical to result from call #3, 1210 tokens saved by not resending it` — unless the content is so small that the reference message itself would cost more tokens than it saves, in which case it's left alone.
2. **Truncate** — if a text block exceeds a configurable character threshold (default 2000), it's cut down with a clear `[...truncated, N characters omitted, use a more specific query to see more...]` marker. Data is never dropped silently.
3. **Count** — before/after token counts are tracked using [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer) (real BPE tokenization, the `o200k_base` encoding used by GPT-4o-family models), and a savings summary is printed to **stderr** (never stdout, since stdout is the JSON-RPC channel) when the process exits.

## Install / quick start

```bash
git clone <this-repo>
cd mcpsqueeze
npm install
npm run build
```

Wherever your agent's MCP client config currently launches a server directly, e.g.:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["real-server.js"]
    }
  }
}
```

point it at `mcpsqueeze wrap` instead, with `--` separating MCP Squeeze's own flags from the original command:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/path/to/mcpsqueeze/dist/cli.js", "wrap", "--", "node", "real-server.js"]
    }
  }
}
```

Or from a shell, for testing:

```bash
node dist/cli.js wrap -- node real-server.js
```

Optional flags (must come before `--`):

- `--truncate-chars <n>` — max characters per text block before truncation (default `2000`).

### Example: before / after

Using the bundled test fixture server (one `get_large_text` tool returning a ~5.6KB deterministic blob), calling it twice in the same session:

```
tools: [ 'echo', 'get_large_text' ]
call 1 (large text) result length: 2082   <- truncated from 5640 chars
call 2 (repeat) result: [mcpsqueeze] Duplicate result suppressed: identical to result from call #1, 1210 tokens saved by not resending it.

[mcpsqueeze] session summary
  tool calls proxied:     2
    - passthrough:       0
    - deduplicated:      1
    - truncated:         1
  tokens before squeeze:  2420
  tokens after squeeze:   504
  tokens saved:           1916 (79.2%)
```

That's a ~79% reduction in tokens sent to the model for these two calls, with the first call's data still fully available (just clipped with a marker telling the agent how to get more) and the second call correctly recognized as an exact repeat.

## Testing

MCP Squeeze ships a second, trivial MCP server (`test/fixtures/test-server.mjs`, with just `echo` and `get_large_text` tools) used purely as a test fixture. The test suite (`vitest`) builds the real CLI, spawns it as a real child process wrapping that fixture, connects to it as a real MCP client, and makes real `tools/list` / `tools/call` requests over stdio — asserting on what actually comes back over the wire:

```bash
npm test
```

This runs `tsc` to build `dist/`, then `vitest run`, covering:

- tool listing is passed through transparently;
- a small, unique result passes through byte-for-byte unchanged;
- an oversized result is truncated with the `[...truncated, ...]` marker;
- identical repeated calls (both large and small-but-worth-deduping) are replaced with a short reference instead of being resent;
- different calls/arguments are never confused with each other;
- a token-savings summary is printed to stderr on shutdown.

Plus a unit test file covering the pure dedup/truncate/token-counting logic in isolation.

## Limitations

This is a focused MVP, not a complete solution. Known limitations:

- **stdio only.** Only MCP's stdio transport is implemented (the common case for locally-run MCP servers). HTTP/SSE-based MCP servers are not supported.
- **Dedup is exact-match, in-memory, per-process-session.** It hashes full result content; near-duplicates (e.g. the same data with a different timestamp field) won't be caught, and nothing persists across proxy restarts.
- **Truncation is character-based and text-only.** It clips oversized `text` content blocks past a character threshold; it does not attempt smart/semantic summarization, and image/audio/resource content blocks are passed through untouched regardless of size.
- **`structuredContent` passes through untouched.** Dedup/truncation currently only inspect the standard `content` array, not the newer `structuredContent` field some tools may also return.
- **Token counts are an estimate.** `gpt-tokenizer`'s `o200k_base` encoding is a real BPE tokenizer, but it's the GPT-4o-family encoding specifically — actual token counts for other model families (e.g. Claude, Llama) will differ somewhat.
- **No dashboard/telemetry export.** Savings are only reported as a one-time human-readable summary on stderr at process exit, not exported anywhere.
- **Single upstream server per invocation.** Each `mcpsqueeze wrap` instance wraps exactly one underlying MCP server; there's no fan-out/aggregation of multiple servers behind one proxy.

## License

MIT — see [LICENSE](./LICENSE).
