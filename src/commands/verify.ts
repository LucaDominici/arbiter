import { resolve } from "node:path";
import { runProbes } from "../compatibility/probe.js";
import { formatText, formatJson } from "../compatibility/report.js";

export interface VerifyOptions {
  dir?: string | undefined;
  json?: boolean | undefined;
}

export function runVerify(opts: VerifyOptions): void {
  const dir = resolve(opts.dir ?? ".");
  const report = runProbes(dir);

  const output = opts.json ? formatJson(report) : formatText(report);
  process.stdout.write(output + "\n");

  if (report.hasFailures) {
    process.exit(1);
  }
}
