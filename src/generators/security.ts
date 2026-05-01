import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface SecurityGeneratorResult {
  files: WriteResult[];
}

export function generateSecurity(
  config: ProjectConfig,
): SecurityGeneratorResult {
  if (!config.enableSecurityScanning) return { files: [] };

  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;
  const results: WriteResult[] = [];

  // PII scanner — always runs early-fail (HARD, no grace)
  results.push(
    writeFile(
      resolvedPath(base, "scripts", "pii-scan.mjs"),
      renderTemplate("scripts/pii-scan.mjs.ejs", data),
      { skipIfExists: false },
    ),
  );

  // Gitleaks config — references .gitleaksignore suppression file
  results.push(
    writeFile(
      resolvedPath(base, ".gitleaks.toml"),
      renderTemplate("security/gitleaks.toml.ejs", data),
      { skipIfExists: true },
    ),
  );

  // Claude hook: block PII in edited files (PostToolUse) — skip when ai-rulez manages .claude/
  if (!config.existing.aiRulez) {
    results.push(
      writeFile(
        resolvedPath(base, ".claude", "hooks", "check-no-pii.mjs"),
        renderTemplate("claude/hooks/check-no-pii.mjs", data),
        { skipIfExists: true },
      ),
    );
  }

  // Java only: OWASP Dependency-Check Gradle snippet
  if (config.language === "java") {
    results.push(
      writeFile(
        resolvedPath(base, "config", "owasp-dependency-check.gradle"),
        renderTemplate("security/owasp-dependency-check.gradle.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  return { files: results };
}
