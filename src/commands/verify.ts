import { resolve } from "node:path";
import { runProbes } from "../compatibility/probe.js";
import { formatText, formatJson } from "../compatibility/report.js";
import { loadConfig } from "../utils/config.js";

export interface VerifyOptions {
  dir?: string | undefined;
  json?: boolean | undefined;
}

export function runVerify(opts: VerifyOptions): void {
  const dir = resolve(opts.dir ?? ".");
  const report = runProbes(dir);

  if (opts.json) {
    // Augment the JSON envelope with the effective (post-env-override) config
    // so external consumers can see exactly what arbiter loaded — #233.
    const cfg = loadConfig(dir);
    const enriched = {
      ...report,
      effectiveConfig: cfg,
    };
    process.stdout.write(formatJson(enriched) + "\n");
  } else {
    process.stdout.write(formatText(report) + "\n");
  }

  if (report.hasFailures) {
    process.exit(1);
  }
}
