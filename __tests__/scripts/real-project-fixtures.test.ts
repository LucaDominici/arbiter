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
});
