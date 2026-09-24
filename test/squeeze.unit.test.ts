import { describe, it, expect } from "vitest";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { truncateText } from "../src/truncate.js";
import { Deduplicator } from "../src/dedup.js";
import { squeezeContent } from "../src/squeeze.js";
import { countTokens } from "../src/tokens.js";

describe("truncateText", () => {
  it("leaves short text untouched", () => {
    const result = truncateText("hello", 2000);
    expect(result).toEqual({ text: "hello", truncated: false, omittedChars: 0 });
  });

  it("truncates long text and appends a clear marker with the omitted count", () => {
    const text = "x".repeat(3000);
    const result = truncateText(text, 2000);
    expect(result.truncated).toBe(true);
    expect(result.omittedChars).toBe(1000);
    expect(result.text.startsWith("x".repeat(2000))).toBe(true);
    expect(result.text).toContain("[...truncated, 1000 characters omitted, use a more specific query to see more...]");
  });
});

describe("countTokens", () => {
  it("returns 0 for empty text", () => {
    expect(countTokens("").tokens).toBe(0);
  });

  it("returns a real BPE-based positive count for normal text, roughly matching char/4", () => {
    const { tokens, method } = countTokens("The quick brown fox jumps over the lazy dog.");
    expect(method).toBe("bpe");
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(20);
  });
});

describe("squeezeContent", () => {
  const textBlock = (text: string): ContentBlock => ({ type: "text", text });

  it("passes small unique content through unchanged on first occurrence", () => {
    const dedup = new Deduplicator();
    const content = [textBlock("small unique text")];
    const { content: out, record } = squeezeContent(content, 1, dedup, { truncateChars: 2000 });

    expect(out).toEqual(content);
    expect(record.outcome).toBe("passthrough");
    expect(record.originalTokens).toBe(record.finalTokens);
  });

  it("truncates oversized content on first occurrence", () => {
    const dedup = new Deduplicator();
    const content = [textBlock("y".repeat(3000))];
    const { content: out, record } = squeezeContent(content, 1, dedup, { truncateChars: 2000 });

    expect(record.outcome).toBe("truncated");
    expect((out[0] as { text: string }).text).toContain("[...truncated,");
    expect(record.finalTokens).toBeLessThan(record.originalTokens);
  });

  it("replaces an exact repeat with a short reference instead of resending it", () => {
    const dedup = new Deduplicator();
    // Long enough that the short dedup reference message is guaranteed to be
    // cheaper than resending the whole thing.
    const content = [textBlock("repeat this exact content. ".repeat(30))];

    const first = squeezeContent(content, 1, dedup, { truncateChars: 2000 });
    const second = squeezeContent(content, 2, dedup, { truncateChars: 2000 });

    expect(first.record.outcome).toBe("passthrough");
    expect(second.record.outcome).toBe("deduped");
    expect((second.content[0] as { text: string }).text).toMatch(/identical to result from call #1/);
    expect(second.record.finalTokens).toBeLessThan(second.record.originalTokens);
  });

  it("does not bother deduping tiny content where the reference message would cost more than it saves", () => {
    const dedup = new Deduplicator();
    const content = [textBlock("hi")];

    const first = squeezeContent(content, 1, dedup, { truncateChars: 2000 });
    const second = squeezeContent(content, 2, dedup, { truncateChars: 2000 });

    expect(first.record.outcome).toBe("passthrough");
    // Not "deduped": for content this small, a reference message would cost
    // more tokens than it saves, so mcpsqueeze just passes it through.
    expect(second.record.outcome).toBe("passthrough");
    expect((second.content[0] as { text: string }).text).toBe("hi");
  });

  it("does not treat different content as duplicates", () => {
    const dedup = new Deduplicator();
    const a = squeezeContent([textBlock("content A")], 1, dedup, { truncateChars: 2000 });
    const b = squeezeContent([textBlock("content B")], 2, dedup, { truncateChars: 2000 });

    expect(a.record.outcome).toBe("passthrough");
    expect(b.record.outcome).toBe("passthrough");
  });
});
