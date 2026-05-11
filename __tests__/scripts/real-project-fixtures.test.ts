import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function readFixture(relPath: string): string {
  return readFileSync(resolve(relPath), "utf-8");
}

describe("real-project fixture regressions", () => {
  it("ts-backend-web-db keeps the L2 TypeScript/testcontainers contract", () => {
    const pkg = JSON.parse(
      readFixture(
        "__tests__/fixtures/real-projects/ts-backend-web-db/package.json",
      ),
    ) as { devDependencies?: Record<string, string> };
    const tsconfig = JSON.parse(
      readFixture(
        "__tests__/fixtures/real-projects/ts-backend-web-db/tsconfig.json",
      ),
    ) as { compilerOptions?: Record<string, string> };

    expect(pkg.devDependencies?.testcontainers).toBeDefined();
    expect(tsconfig.compilerOptions?.moduleResolution).toBe("Bundler");
  });

  it("python-library keeps pytest-cov in the test extra for L2 coverage", () => {
    const pyproject = readFixture(
      "__tests__/fixtures/real-projects/python-library/pyproject.toml",
    );
    expect(pyproject).toContain("pytest-cov");
  });

  it("java-backend-web-db-gradle keeps jacoco, spotless, and generated test deps wired", () => {
    const buildGradle = readFixture(
      "__tests__/fixtures/real-projects/java-backend-web-db-gradle/build.gradle",
    );
    const checkstyle = readFixture(
      "__tests__/fixtures/real-projects/java-backend-web-db-gradle/config/checkstyle/checkstyle.xml",
    );

    expect(
      existsSync(
        resolve(
          "__tests__/fixtures/real-projects/java-backend-web-db-gradle/gradle/jacoco.gradle",
        ),
      ),
    ).toBe(true);
    expect(buildGradle).toContain("com.diffplug.spotless");
    expect(buildGradle).toContain("apply from: 'gradle/jacoco.gradle'");
    expect(buildGradle).toContain("org.assertj:assertj-core");
    expect(buildGradle).toContain("archunit-junit5");
    expect(checkstyle).not.toContain("<!DOCTYPE");
  });

  it("java-backend-web-db-gradle has PMD and SpotBugs configs wired (#404)", () => {
    const buildGradle = readFixture(
      "__tests__/fixtures/real-projects/java-backend-web-db-gradle/build.gradle",
    );
    const jacocoGradle = readFixture(
      "__tests__/fixtures/real-projects/java-backend-web-db-gradle/gradle/jacoco.gradle",
    );

    expect(
      existsSync(
        resolve(
          "__tests__/fixtures/real-projects/java-backend-web-db-gradle/config/pmd/ruleset.xml",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        resolve(
          "__tests__/fixtures/real-projects/java-backend-web-db-gradle/config/spotbugs/spotbugs-exclude.xml",
        ),
      ),
    ).toBe(true);
    expect(buildGradle).toContain("pmd");
    expect(buildGradle).toContain("com.github.spotbugs");
    expect(jacocoGradle).toContain("jacocoTestCoverageVerification");
    expect(jacocoGradle).toContain("check.dependsOn");
  });

  it("java-library-gradle keeps spotless and generated test deps wired", () => {
    const buildGradle = readFixture(
      "__tests__/fixtures/real-projects/java-library-gradle/build.gradle",
    );
    const checkstyle = readFixture(
      "__tests__/fixtures/real-projects/java-library-gradle/config/checkstyle/checkstyle.xml",
    );

    expect(buildGradle).toContain("com.diffplug.spotless");
    expect(buildGradle).toContain("org.assertj:assertj-core");
    expect(buildGradle).toContain("archunit-junit5");
    expect(checkstyle).not.toContain("<!DOCTYPE");
  });

  it("rust-library keeps must_use on the public API used by clippy pedantic", () => {
    const lib = readFixture(
      "__tests__/fixtures/real-projects/rust-library/src/lib.rs",
    );
    expect(lib).toMatch(/#\[must_use\]\s+pub fn add/);
    expect(lib).toMatch(/#\[must_use\]\s+pub fn multiply/);
  });

  it("ts-bdd fixture has @cucumber/cucumber dep and feature file", () => {
    const pkg = JSON.parse(
      readFixture("__tests__/fixtures/real-projects/ts-bdd/package.json"),
    ) as { devDependencies?: Record<string, string> };
    expect(pkg.devDependencies?.["@cucumber/cucumber"]).toBeDefined();
    expect(
      existsSync(
        resolve(
          "__tests__/fixtures/real-projects/ts-bdd/features/example.feature",
        ),
      ),
    ).toBe(true);
  });

  it("python-bdd fixture has pytest-bdd dep and feature file", () => {
    const pyproject = readFixture(
      "__tests__/fixtures/real-projects/python-bdd/pyproject.toml",
    );
    expect(pyproject).toContain("pytest-bdd");
    expect(
      existsSync(
        resolve(
          "__tests__/fixtures/real-projects/python-bdd/tests/bdd/features/example.feature",
        ),
      ),
    ).toBe(true);
  });

  it("go-bdd fixture has godog dep and feature file", () => {
    const goMod = readFixture("__tests__/fixtures/real-projects/go-bdd/go.mod");
    expect(goMod).toContain("cucumber/godog");
    expect(
      existsSync(
        resolve(
          "__tests__/fixtures/real-projects/go-bdd/features/example.feature",
        ),
      ),
    ).toBe(true);
  });

  it("java-bdd-gradle fixture has cucumber-jvm dep and feature file", () => {
    const buildGradle = readFixture(
      "__tests__/fixtures/real-projects/java-bdd-gradle/build.gradle",
    );
    expect(buildGradle).toContain("cucumber-java");
    expect(
      existsSync(
        resolve(
          "__tests__/fixtures/real-projects/java-bdd-gradle/src/test/resources/features/example.feature",
        ),
      ),
    ).toBe(true);
  });

  it("rust-bdd fixture has cucumber dep and feature file", () => {
    const cargoToml = readFixture(
      "__tests__/fixtures/real-projects/rust-bdd/Cargo.toml",
    );
    expect(cargoToml).toContain("cucumber");
    expect(
      existsSync(
        resolve(
          "__tests__/fixtures/real-projects/rust-bdd/tests/features/example.feature",
        ),
      ),
    ).toBe(true);
  });
});
