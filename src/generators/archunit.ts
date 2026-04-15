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

  const files: WriteResult[] = [];

  // INV-29: NoMockMvc rule — always emitted for Java (test-quality rule, not architecture-style)
  files.push(
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
  );

  // Architecture style rules — only when user explicitly chose a style (ADR-021 gate rule)
  if (config.architectureStyle !== "none") {
    files.push(
      writeFile(
        resolvedPath(
          base,
          "src",
          "test",
          "java",
          packagePath,
          "ArchitectureTest.java",
        ),
        renderTemplate("archunit/ArchitectureTest.java.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  return { files };
}
