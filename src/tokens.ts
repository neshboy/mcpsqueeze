/**
 * Token estimation.
 *
 * Real BPE-based counting is provided by `gpt-tokenizer`, using its default
 * `o200k_base` encoding (the encoding used by the GPT-4o model family). This
 * is a real tokenizer, not a fake stand-in — it produces the same token
 * boundaries a GPT-4o-class model would see.
 *
 * If the tokenizer ever throws (e.g. some unexpected input), we fall back to
 * a clearly-labeled heuristic of chars/4, the commonly cited rule-of-thumb
 * for English text. The fallback is intentionally conservative and is not
 * expected to trigger in normal operation.
 */
import { countTokens as bpeCountTokens } from "gpt-tokenizer";

export type TokenCountMethod = "bpe" | "heuristic";

export interface TokenCount {
  tokens: number;
  method: TokenCountMethod;
}

/** chars/4 heuristic, used only if the real tokenizer fails. */
export function heuristicTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Counts tokens in `text` using the real gpt-tokenizer BPE encoder.
 * Falls back to the heuristic (and reports that in `.method`) only if the
 * tokenizer throws.
 */
export function countTokens(text: string): TokenCount {
  if (!text) return { tokens: 0, method: "bpe" };
  try {
    return { tokens: bpeCountTokens(text), method: "bpe" };
  } catch {
    return { tokens: heuristicTokenCount(text), method: "heuristic" };
  }
}

/** Convenience: just the number, for call sites that don't care about method. */
export function countTokensSimple(text: string): number {
  return countTokens(text).tokens;
}
