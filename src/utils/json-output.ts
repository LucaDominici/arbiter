export type JsonStatus = "ok" | "warning" | "error";

interface JsonEnvelope {
  command: string;
  version: "1";
  status: JsonStatus;
  data: Record<string, unknown>;
  errors?: string[];
}

/**
 * Emit a structured JSON envelope to stdout and exit with the appropriate
 * code: 0 = ok, 1 = error, 2 = warning.
 *
 * Call site is responsible for calling process.exit() after if needed;
 * this function only writes output and does NOT exit.
 */
export function jsonOutput(
  command: string,
  status: JsonStatus,
  data: Record<string, unknown>,
  errors?: string[],
): void {
  const envelope: JsonEnvelope = {
    command,
    version: "1",
    status,
    data,
    ...(errors !== undefined && errors.length > 0 ? { errors } : {}),
  };
  process.stdout.write(JSON.stringify(envelope) + "\n");
}

/**
 * Map a JSON status to a process exit code.
 * ok → 0, error → 1, warning → 2
 */
export function statusToExitCode(status: JsonStatus): number {
  if (status === "error") return 1;
  if (status === "warning") return 2;
  return 0;
}
