/** What we remember about the first time a given result hash was seen. */
export interface DedupEntry {
  /** The 1-based index of the tool call (within the session) that first produced this content. */
  callIndex: number;
  /** Token count of the original (pre-truncation) content, for reporting "N tokens saved". */
  tokens: number;
}

/**
 * Tracks content hashes seen so far in a session so that identical tool
 * results can be replaced with a short reference instead of being resent in
 * full.
 */
export class Deduplicator {
  private readonly seen = new Map<string, DedupEntry>();

  /** Returns the entry for `hash` if this exact content was already returned earlier in the session. */
  lookup(hash: string): DedupEntry | undefined {
    return this.seen.get(hash);
  }

  /** Records that `hash` was returned (in full) by the call at `callIndex`. No-op if already recorded. */
  remember(hash: string, entry: DedupEntry): void {
    if (!this.seen.has(hash)) {
      this.seen.set(hash, entry);
    }
  }
}
