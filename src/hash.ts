import { createHash } from "node:crypto";

/**
 * Produces a stable content hash for a value that has already been reduced
 * to a canonical JSON string. Used to detect identical tool-call results
 * across a session for deduplication.
 */
export function hashCanonical(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
