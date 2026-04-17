import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface BehavioralTestsResult {
  files: WriteResult[];
}

export function generateBehavioralTests(
  config: ProjectConfig,
): BehavioralTestsResult {
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;
  const results: WriteResult[] = [];

  // Language-specific behavioral test example
  if (config.language === "java") {
    const testPkg = config.basePackage
      ? `src/test/java/${config.basePackage.replace(/\./g, "/")}/example`
      : "src/test/java/example";
    results.push(
      writeFile(
        resolvedPath(base, testPkg, "ExampleBehavioralTest.java"),
        renderTemplate("behavioral-tests/ExampleBehavioralTest.java.ejs", data),
        { skipIfExists: true },
      ),
    );
  } else if (config.language === "typescript") {
    results.push(
      writeFile(
        resolvedPath(base, "src", "test", "example.behavioral.test.ts"),
        renderTemplate("behavioral-tests/example.behavioral.test.ts.ejs", data),
        { skipIfExists: true },
      ),
    );
  } else if (config.language === "rust") {
    results.push(
      writeFile(
        resolvedPath(base, "tests", "example_behavioral_test.rs"),
        renderTemplate("behavioral-tests/example_behavioral_test.rs.ejs", data),
        { skipIfExists: true },
      ),
    );
  } else if (config.language === "go") {
    results.push(
      writeFile(
        resolvedPath(base, "internal", "example_behavioral_test.go"),
        renderTemplate("behavioral-tests/example_behavioral_test.go.ejs", data),
        { skipIfExists: true },
      ),
    );
  } else if (config.language === "python") {
    results.push(
      writeFile(
        resolvedPath(base, "tests", "test_example_behavioral.py"),
        renderTemplate("behavioral-tests/test_example_behavioral.py.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  // Testing policy document — all languages, all governance levels
  results.push(
    writeFile(
      resolvedPath(base, "docs", "TESTING_POLICY.md"),
      renderTemplate("behavioral-tests/TESTING_POLICY.md.ejs", data),
      { skipIfExists: true },
    ),
  );

  // Naming convention gate script — all languages
  results.push(
    writeFile(
      resolvedPath(base, "scripts", "check-test-naming.mjs"),
      renderTemplate("scripts/check-test-naming.mjs.ejs", data),
      { skipIfExists: false },
    ),
  );

  // Playwright ESLint config — only for frontend-spa TypeScript projects
  if (config.archetype === "frontend-spa" && config.language === "typescript") {
    results.push(
      writeFile(
        resolvedPath(base, ".eslintrc-playwright.json"),
        renderTemplate("behavioral-tests/eslint-playwright.json.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  return { files: results };
}
