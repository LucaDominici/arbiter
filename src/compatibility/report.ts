import type { ProbeResult, VerifyReport } from "./schema.js";

function versionStr(p: ProbeResult): string {
  if (!p.version) return "";
  return `${p.version.major}.${p.version.minor}.${p.version.patch}`;
}

export function formatText(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push(`arbiter verify — stack: ${report.stack}  dir: ${report.dir}`);
  lines.push("");

  for (const p of report.probes) {
    const ver = versionStr(p);
    const detail = p.reason ? `  (${p.reason})` : ver ? `  ${ver}` : "";
    lines.push(`  [${p.status}] ${p.tool}${detail}`);
  }

  lines.push("");
  lines.push(report.hasFailures ? "Result: FAIL" : "Result: OK");
  return lines.join("\n");
}

export function formatJson(report: VerifyReport): string {
  return JSON.stringify(report, null, 2);
}
