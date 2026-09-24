export type CallOutcome = "passthrough" | "deduped" | "truncated";

export interface CallRecord {
  index: number;
  toolName: string;
  outcome: CallOutcome;
  originalTokens: number;
  finalTokens: number;
  originalChars: number;
  finalChars: number;
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

/**
 * Accumulates per-call before/after token and character counts for a single
 * proxy session, and can render a human-readable savings summary.
 */
export class SessionStats {
  private readonly calls: CallRecord[] = [];

  record(rec: CallRecord): void {
    this.calls.push(rec);
  }

  get totalCalls(): number {
    return this.calls.length;
  }

  get totalOriginalTokens(): number {
    return sum(this.calls.map((c) => c.originalTokens));
  }

  get totalFinalTokens(): number {
    return sum(this.calls.map((c) => c.finalTokens));
  }

  get tokensSaved(): number {
    return this.totalOriginalTokens - this.totalFinalTokens;
  }

  get dedupCount(): number {
    return this.calls.filter((c) => c.outcome === "deduped").length;
  }

  get truncatedCount(): number {
    return this.calls.filter((c) => c.outcome === "truncated").length;
  }

  get passthroughCount(): number {
    return this.calls.filter((c) => c.outcome === "passthrough").length;
  }

  getCalls(): readonly CallRecord[] {
    return this.calls;
  }

  /** Renders a human-readable multi-line summary suitable for stderr. */
  formatSummary(): string {
    if (this.calls.length === 0) {
      return "[mcpsqueeze] No tool calls were proxied this session.";
    }

    const before = this.totalOriginalTokens;
    const after = this.totalFinalTokens;
    const saved = this.tokensSaved;
    const pct = before > 0 ? ((saved / before) * 100).toFixed(1) : "0.0";

    const lines = [
      "[mcpsqueeze] session summary",
      `  tool calls proxied:     ${this.totalCalls}`,
      `    - passthrough:       ${this.passthroughCount}`,
      `    - deduplicated:      ${this.dedupCount}`,
      `    - truncated:         ${this.truncatedCount}`,
      `  tokens before squeeze:  ${before}`,
      `  tokens after squeeze:   ${after}`,
      `  tokens saved:           ${saved} (${pct}%)`,
    ];

    return lines.join("\n");
  }
}
