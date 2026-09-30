export interface TruncateResult {
  text: string;
  truncated: boolean;
  /** Number of characters removed from the original text. */
  omittedChars: number;
}

/**
 * Truncates `text` to at most `maxChars` characters, appending a clear
 * marker describing how much was omitted. Never silently drops data without
 * flagging it.
 */
export function truncateText(text: string, maxChars: number): TruncateResult {
  if (maxChars <= 0 || text.length <= maxChars) {
    return { text, truncated: false, omittedChars: 0 };
  }

  const omittedChars = text.length - maxChars;
  const marker = `\n[...truncated, ${omittedChars} characters omitted, use a more specific query to see more...]`;
  const truncatedText = text.slice(0, maxChars) + marker;

  // If the marker overhead makes the "truncated" text no shorter than the
  // original (only possible when text is just barely over maxChars), keep
  // the original untouched — truncation should never make things worse.
  if (truncatedText.length >= text.length) {
    return { text, truncated: false, omittedChars: 0 };
  }

  return {
    text: truncatedText,
    truncated: true,
    omittedChars,
  };
}
