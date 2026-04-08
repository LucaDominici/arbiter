import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface ArchUnitGeneratorResult {
  files: WriteResult[];
}

export function generateArchUnit(
  config: ProjectConfig,
): ArchUnitGeneratorResult {
  if (config.language !== "java") return { files: [] };

  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  const packagePath = config.basePackage
    ? config.basePackage.replace(/\./g, "/") + "/architecture"
    : "architecture";

  return {
    files: [
      writeFile(
        resolvedPath(
          base,
          "src",
          "test",
          "java",
          packagePath,
          "NoMockMvcTest.java",
        ),
        renderTemplate("archunit/NoMockMvcTest.java.ejs", data),
        { skipIfExists: true },
      ),
    ],
  };
}
