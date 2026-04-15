import { runCli, CliError } from "../utils/run-cli.js";
import { detectLanguage } from "../detectors/language.js";
import { matches } from "./matcher.js";
import {
  parseNodeVersion,
  parseNpmVersion,
  parseJavaVersion,
  parseGradleVersion,
  parseMavenVersion,
  parseRustVersion,
  parseCargoVersion,
  parseGoVersion,
  parsePythonVersion,
  parsePipVersion,
} from "./parsers.js";
import type { SemVer } from "./parsers.js";
import type { ProbeResult, VerifyReport } from "./schema.js";
import matrixJson from "./matrix.json" with { type: "json" };

type OutputChannel = "stdout" | "stderr";

interface ToolSpec {
  args: readonly string[];
  channel: OutputChannel;
  parse: (raw: string) => SemVer | null;
}

const TOOL_SPECS: Record<string, ToolSpec> = {
  node: { args: ["--version"], channel: "stdout", parse: parseNodeVersion },
  npm: { args: ["--version"], channel: "stdout", parse: parseNpmVersion },
  java: { args: ["-version"], channel: "stderr", parse: parseJavaVersion },
  gradle: {
    args: ["--version"],
    channel: "stdout",
    parse: parseGradleVersion,
  },
  mvn: { args: ["--version"], channel: "stdout", parse: parseMavenVersion },
  rustc: { args: ["--version"], channel: "stdout", parse: parseRustVersion },
  cargo: { args: ["--version"], channel: "stdout", parse: parseCargoVersion },
  go: { args: ["version"], channel: "stdout", parse: parseGoVersion },
  python3: {
    args: ["--version"],
    channel: "stdout",
    parse: parsePythonVersion,
  },
  pip: { args: ["--version"], channel: "stdout", parse: parsePipVersion },
};

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Probe a single tool: run its version command and check against the range.
 * Exported for unit testing.
 */
export function probeTool(
  tool: string,
  args: readonly string[],
  range: string,
  channel: OutputChannel,
): ProbeResult {
  const parse =
    TOOL_SPECS[tool]?.parse ??
    ((raw: string) => {
      void raw;
      return null;
    });

  let raw: string;
  try {
    const result = runCli(tool, args, { timeoutMs: PROBE_TIMEOUT_MS });
    raw = channel === "stderr" ? result.stderr : result.stdout;
  } catch (err) {
    if (err instanceof CliError) {
      return { tool, status: "skipped", reason: "toolchain-missing" };
    }
    throw err;
  }

  const version = parse(raw);
  if (version === null) {
    return {
      tool,
      status: "failed",
      reason: `unrecognized version output: ${raw.trim().slice(0, 60)}`,
    };
  }

  if (!matches(version, range)) {
    return {
      tool,
      status: "failed",
      version,
      reason: `version ${version.major}.${version.minor} outside ${range}`,
    };
  }

  return { tool, status: "passed", version };
}

type RawMatrix = {
  typescript: Array<{ tool: string; range: string }>;
  java: Array<{ tool: string; range: string }>;
  rust: Array<{ tool: string; range: string }>;
  go: Array<{ tool: string; range: string }>;
  python: Array<{ tool: string; range: string }>;
};

const MATRIX = matrixJson as RawMatrix;

/**
 * Run all tool probes for the detected stack in the given directory.
 */
export function runProbes(dir: string): VerifyReport {
  const lang = detectLanguage(dir);

  const entries: Array<{ tool: string; range: string }> =
    lang === "typescript"
      ? MATRIX.typescript
      : lang === "java"
        ? MATRIX.java
        : lang === "rust"
          ? MATRIX.rust
          : lang === "go"
            ? MATRIX.go
            : lang === "python"
              ? MATRIX.python
              : [];

  const probes: ProbeResult[] = entries.map(({ tool, range }) => {
    const spec = TOOL_SPECS[tool];
    if (!spec) {
      return { tool, status: "failed", reason: `no spec for tool: ${tool}` };
    }
    return probeTool(tool, spec.args, range, spec.channel);
  });

  const hasFailures = probes.some((p) => p.status === "failed");

  return { dir, stack: lang, probes, hasFailures };
}
