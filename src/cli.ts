#!/usr/bin/env node
import { startProxy } from "./proxy.js";

const DEFAULT_TRUNCATE_CHARS = 2000;

function printUsage(): void {
  process.stderr.write(
    "mcpsqueeze - a drop-in, token-saving proxy for MCP servers\n\n" +
      "Usage:\n" +
      "  mcpsqueeze wrap [--truncate-chars <n>] -- <command> [args...]\n\n" +
      "Example:\n" +
      "  mcpsqueeze wrap -- node real-server.js\n\n" +
      "Point your agent's MCP client config at `mcpsqueeze wrap -- <original command>`\n" +
      "instead of the original command directly. Everything else behaves exactly like\n" +
      "the wrapped server, except large/duplicate tool results are squeezed down and a\n" +
      "token-savings summary is printed to stderr when the process exits.\n",
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] !== "wrap") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const rest = argv.slice(1);
  const sepIndex = rest.indexOf("--");
  if (sepIndex === -1) {
    process.stderr.write(
      "[mcpsqueeze] error: missing '--' separator before the wrapped server command.\n\n",
    );
    printUsage();
    process.exitCode = 1;
    return;
  }

  const flagArgs = rest.slice(0, sepIndex);
  const commandArgs = rest.slice(sepIndex + 1);

  if (commandArgs.length === 0) {
    process.stderr.write(
      "[mcpsqueeze] error: no command given to launch the wrapped MCP server.\n\n",
    );
    printUsage();
    process.exitCode = 1;
    return;
  }

  let truncateChars = DEFAULT_TRUNCATE_CHARS;
  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === "--truncate-chars") {
      const value = flagArgs[++i];
      const parsed = Number(value);
      if (!value || Number.isNaN(parsed) || parsed <= 0) {
        process.stderr.write(
          `[mcpsqueeze] error: --truncate-chars requires a positive number, got "${value}"\n`,
        );
        process.exitCode = 1;
        return;
      }
      truncateChars = parsed;
    } else {
      process.stderr.write(`[mcpsqueeze] warning: unknown flag "${arg}" ignored\n`);
    }
  }

  const [command, ...commandRest] = commandArgs;

  const session = await startProxy({ command, args: commandRest, truncateChars });

  let summaryPrinted = false;
  const printSummary = (): void => {
    if (summaryPrinted) return;
    summaryPrinted = true;
    process.stderr.write("\n" + session.stats.formatSummary() + "\n");
  };

  // The agent client closing its end of our stdin is the normal shutdown
  // signal for a stdio MCP server.
  process.stdin.on("close", () => {
    printSummary();
    void session.close().finally(() => process.exit(0));
  });

  process.on("exit", printSummary);
  process.on("SIGINT", () => {
    printSummary();
    void session.close().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    printSummary();
    void session.close().finally(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[mcpsqueeze] fatal error: ${message}\n`);
  process.exit(1);
});
