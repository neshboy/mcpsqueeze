import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { hashCanonical } from "./hash.js";
import { countTokensSimple } from "./tokens.js";
import { truncateText } from "./truncate.js";
import type { Deduplicator } from "./dedup.js";
import type { CallOutcome, CallRecord } from "./stats.js";

export interface SqueezeOptions {
  /** Max characters allowed per text content block before truncation kicks in. */
  truncateChars: number;
}

export type SqueezeRecord = Omit<CallRecord, "index" | "toolName">;

export interface SqueezeResult {
  content: ContentBlock[];
  record: SqueezeRecord;
}

function canonicalize(content: ContentBlock[]): string {
  // JSON.stringify gives us a deterministic canonical form for hashing and
  // token-counting purposes covering text, images, resources, etc.
  return JSON.stringify(content);
}

function textLength(content: ContentBlock[]): number {
  return content.reduce((n, block) => (block.type === "text" ? n + block.text.length : n), 0);
}

/**
 * Applies MCP Squeeze's core dedup + truncation pipeline to a single
 * tool-call result's content blocks.
 *
 * Order matters: dedup is checked against the *original* (pre-truncation)
 * content, so that repeated identical calls are always fully replaced with a
 * short reference — even if the first occurrence was itself truncated.
 */
export function squeezeContent(
  content: ContentBlock[],
  callIndex: number,
  dedup: Deduplicator,
  options: SqueezeOptions,
): SqueezeResult {
  const canonicalOriginal = canonicalize(content);
  const hash = hashCanonical(canonicalOriginal);
  const originalChars = textLength(content) || canonicalOriginal.length;
  const originalTokens = countTokensSimple(canonicalOriginal);

  const priorHit = dedup.lookup(hash);
  if (priorHit) {
    const refText =
      `[mcpsqueeze] Duplicate result suppressed: identical to result from call #${priorHit.callIndex}, ` +
      `${priorHit.tokens} tokens saved by not resending it.`;
    const finalTokens = countTokensSimple(refText);

    // For very small results, the reference message itself can cost more
    // tokens than the original content did. Deduping should never make
    // things worse, so only replace the content when it's a net win.
    if (finalTokens < originalTokens) {
      const outcome: CallOutcome = "deduped";
      return {
        content: [{ type: "text", text: refText }],
        record: {
          outcome,
          originalTokens,
          finalTokens,
          originalChars,
          finalChars: refText.length,
        },
      };
    }
  }

  let truncatedAny = false;
  const processed: ContentBlock[] = content.map((block) => {
    if (block.type !== "text") return block;
    const result = truncateText(block.text, options.truncateChars);
    if (result.truncated) truncatedAny = true;
    return { ...block, text: result.text };
  });

  const canonicalFinal = truncatedAny ? canonicalize(processed) : canonicalOriginal;
  const finalTokens = truncatedAny ? countTokensSimple(canonicalFinal) : originalTokens;
  const finalChars = truncatedAny ? textLength(processed) || canonicalFinal.length : originalChars;

  // Remember what was *actually sent* for this call (post-truncation), not
  // the raw pre-truncation size, so a future duplicate's "tokens saved"
  // reference reflects the real incremental benefit on top of truncation.
  dedup.remember(hash, { callIndex, tokens: finalTokens });

  const outcome: CallOutcome = truncatedAny ? "truncated" : "passthrough";

  return {
    content: processed,
    record: { outcome, originalTokens, finalTokens, originalChars, finalChars },
  };
}
