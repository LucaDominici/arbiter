import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface SkillsGeneratorResult {
  files: WriteResult[];
}

const SKILL_NAMES = [
  "tdd",
  "verification",
  "architect-review",
  "clean-code",
  "understand-code",
  "codebase-audit",
  "epic-decompose",
  "configure",
] as const;

export function generateSkills(config: ProjectConfig): SkillsGeneratorResult {
  if (!config.tools.includes("claude")) return { files: [] };

  const data = config as unknown as Record<string, unknown>;
  const base = config.targetDir;

  const files = SKILL_NAMES.map((name) =>
    writeFile(
      resolvedPath(base, ".claude", "skills", name, "SKILL.md"),
      renderTemplate(`claude/skills/${name}/SKILL.md.ejs`, data),
      { skipIfExists: true },
    ),
  );

  return { files };
}
