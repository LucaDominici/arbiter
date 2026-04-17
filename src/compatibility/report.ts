import type { ProbeResult, VerifyReport } from "./schema.js";

const REMEDIATION: Partial<Record<string, string>> = {
  node: "Upgrade Node.js: https://nodejs.org/en/download",
  npm: "Upgrade npm: npm install -g npm",
  java: "Upgrade JDK: https://adoptium.net",
  gradle: "Upgrade Gradle wrapper: ./gradlew wrapper --gradle-version=8.x",
  mvn: "Upgrade Maven: https://maven.apache.org/download.cgi",
  rustc: "Upgrade Rust: rustup update stable",
  cargo: "Upgrade Cargo (via rustup): rustup update stable",
  go: "Upgrade Go: https://go.dev/dl",
  python3: "Upgrade Python: https://python.org/downloads",
  pip: "Upgrade pip: python3 -m pip install --upgrade pip",
  ruff: "Install/upgrade ruff: pip install --upgrade ruff",
  kotlinc: "Upgrade Kotlin: https://kotlinlang.org/docs/releases.html",
  "gradlew:help":
    "Check Gradle wrapper version: ./gradlew wrapper --gradle-version=X",
  "tsc:noEmit":
    "Fix TypeScript errors or install: npm install --save-dev typescript",
  "cargo:check": "Fix Rust compile errors: cargo check",
  "go:build": "Fix Go build errors: go build ./...",
  "ruff:version": "Install ruff: pip install ruff",
};

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
    if (p.status === "failed") {
      const hint = REMEDIATION[p.tool] ?? "See tool documentation";
      lines.push(`    → ${hint}`);
    }
  }

  lines.push("");
  lines.push(report.hasFailures ? "Result: FAIL" : "Result: OK");
  return lines.join("\n");
}

export function formatJson(report: VerifyReport): string {
  return JSON.stringify(report, null, 2);
}
