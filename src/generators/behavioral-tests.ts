import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface BehavioralTestsResult {
  files: WriteResult[];
}

function emitJavaBdd(
  base: string,
  data: Record<string, unknown>,
  config: ProjectConfig,
): WriteResult[] {
  const testPkg = config.basePackage
    ? `src/test/java/${config.basePackage.replace(/\./g, "/")}/example`
    : "src/test/java/example";
  const bddPkg = config.basePackage
    ? `src/test/java/${config.basePackage.replace(/\./g, "/")}/bdd`
    : "src/test/java/com/example/bdd";
  return [
    writeFile(
      resolvedPath(base, testPkg, "ExampleBehavioralTest.java"),
      renderTemplate("behavioral-tests/ExampleBehavioralTest.java.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, bddPkg, "ExampleBddIT.java"),
      renderTemplate("behavioral-tests/bdd/ExampleBddIT.java.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(
        base,
        "src",
        "test",
        "resources",
        "features",
        "example.feature",
      ),
      renderTemplate("behavioral-tests/bdd/example.feature.ejs", data),
      { skipIfExists: true },
    ),
  ];
}

function emitTypeScriptBdd(
  base: string,
  data: Record<string, unknown>,
): WriteResult[] {
  return [
    writeFile(
      resolvedPath(base, "src", "test", "example.behavioral.test.ts"),
      renderTemplate("behavioral-tests/example.behavioral.test.ts.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, "features", "step_definitions", "example.steps.ts"),
      renderTemplate("behavioral-tests/bdd/example.steps.ts.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, "features", "example.feature"),
      renderTemplate("behavioral-tests/bdd/example.feature.ejs", data),
      { skipIfExists: true },
    ),
  ];
}

function emitRustBdd(
  base: string,
  data: Record<string, unknown>,
): WriteResult[] {
  return [
    writeFile(
      resolvedPath(base, "tests", "example_behavioral_test.rs"),
      renderTemplate("behavioral-tests/example_behavioral_test.rs.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, "tests", "example_bdd_test.rs"),
      renderTemplate("behavioral-tests/bdd/example_bdd_test.rs.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, "tests", "features", "example.feature"),
      renderTemplate("behavioral-tests/bdd/example.feature.ejs", data),
      { skipIfExists: true },
    ),
  ];
}

function emitGoBdd(base: string, data: Record<string, unknown>): WriteResult[] {
  return [
    writeFile(
      resolvedPath(base, "internal", "example_behavioral_test.go"),
      renderTemplate("behavioral-tests/example_behavioral_test.go.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, "internal", "bdd", "example_test.go"),
      renderTemplate("behavioral-tests/bdd/example_test.go.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, "features", "example.feature"),
      renderTemplate("behavioral-tests/bdd/example.feature.ejs", data),
      { skipIfExists: true },
    ),
  ];
}

function emitPythonBdd(
  base: string,
  data: Record<string, unknown>,
): WriteResult[] {
  return [
    writeFile(
      resolvedPath(base, "tests", "test_example_behavioral.py"),
      renderTemplate("behavioral-tests/test_example_behavioral.py.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, "tests", "bdd", "test_example_bdd.py"),
      renderTemplate("behavioral-tests/bdd/test_example_bdd.py.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, "tests", "bdd", "features", "example.feature"),
      renderTemplate("behavioral-tests/bdd/example.feature.ejs", data),
      { skipIfExists: true },
    ),
  ];
}

export function generateBehavioralTests(
  config: ProjectConfig,
): BehavioralTestsResult {
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;
  const results: WriteResult[] = [];

  if (config.language === "java")
    results.push(...emitJavaBdd(base, data, config));
  else if (config.language === "typescript")
    results.push(...emitTypeScriptBdd(base, data));
  else if (config.language === "rust") results.push(...emitRustBdd(base, data));
  else if (config.language === "go") results.push(...emitGoBdd(base, data));
  else if (config.language === "python")
    results.push(...emitPythonBdd(base, data));

  results.push(
    writeFile(
      resolvedPath(base, "docs", "TESTING_POLICY.md"),
      renderTemplate("behavioral-tests/TESTING_POLICY.md.ejs", data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, "scripts", "check-test-naming.mjs"),
      renderTemplate("scripts/check-test-naming.mjs.ejs", data),
      { skipIfExists: false },
    ),
  );

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
