import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { Language } from "../wizard/types.js";

export interface DetectedModule {
  name: string;
  path: string;
  language: Language;
  kind:
    | "workspace"
    | "subdir"
    | "gradle-module"
    | "maven-module"
    | "go-package";
}

const FALLBACK_SOURCE_DIRS = [
  "src",
  "lib",
  "backend",
  "frontend",
  "api",
  "worker",
  "contracts",
];

export function detectModules(
  dir: string,
  language: Language,
): DetectedModule[] {
  if (!existsSync(dir)) return [];

  switch (language) {
    case "typescript":
      return detectTsModules(dir);
    case "java":
      return detectJavaModules(dir);
    case "go":
      return detectGoModules(dir);
    case "rust":
      return detectRustModules(dir);
    case "python":
      return detectPythonModules(dir);
    default:
      return [];
  }
}

function detectTsModules(dir: string): DetectedModule[] {
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        workspaces?: string[] | { packages?: string[] };
      };
      const patterns = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : (pkg.workspaces?.packages ?? []);
      if (patterns.length > 0) {
        return expandWorkspaces(dir, patterns);
      }
    } catch {
      // fall through to top-level subdir fallback
    }
  }
  return fallbackTopLevelDirs(dir, "typescript");
}

function expandWorkspaces(dir: string, patterns: string[]): DetectedModule[] {
  const results: DetectedModule[] = [];
  for (const pattern of patterns) {
    const match = pattern.match(/^(.+)\/\*$/);
    const parentRel = match?.[1] ?? pattern;
    const parent = join(dir, parentRel);
    if (!existsSync(parent)) continue;

    if (match) {
      for (const child of readdirSync(parent)) {
        const childDir = join(parent, child);
        if (!statSync(childDir).isDirectory()) continue;
        const name = readWorkspaceName(childDir) ?? child;
        results.push({
          name,
          path: childDir,
          language: "typescript",
          kind: "workspace",
        });
      }
    } else {
      const name = readWorkspaceName(parent) ?? basename(parent);
      results.push({
        name,
        path: parent,
        language: "typescript",
        kind: "workspace",
      });
    }
  }
  return results;
}

function readWorkspaceName(dir: string): string | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
    return pkg.name ?? null;
  } catch {
    return null;
  }
}

function fallbackTopLevelDirs(
  dir: string,
  language: Language,
): DetectedModule[] {
  const results: DetectedModule[] = [];
  for (const candidate of FALLBACK_SOURCE_DIRS) {
    const p = join(dir, candidate);
    if (existsSync(p) && statSync(p).isDirectory()) {
      results.push({
        name: candidate,
        path: p,
        language,
        kind: "subdir",
      });
    }
  }
  return results;
}

function detectJavaModules(dir: string): DetectedModule[] {
  const settings = join(dir, "settings.gradle");
  const settingsKts = join(dir, "settings.gradle.kts");
  const gradlePath = existsSync(settings)
    ? settings
    : existsSync(settingsKts)
      ? settingsKts
      : null;

  if (gradlePath) {
    const content = readFileSync(gradlePath, "utf-8");
    const names = Array.from(
      content.matchAll(/include\s*\(?\s*['"]:?([^'"\s,)]+)['"]/g),
      (m) => (m[1] ?? "").replace(/^:/, "").split(":").pop() ?? "",
    ).filter((s) => s.length > 0);
    return names.map((name) => ({
      name,
      path: join(dir, name),
      language: "java",
      kind: "gradle-module",
    }));
  }

  const pomPath = join(dir, "pom.xml");
  if (existsSync(pomPath)) {
    const content = readFileSync(pomPath, "utf-8");
    const names = Array.from(
      content.matchAll(/<module>([^<]+)<\/module>/g),
      (m) => (m[1] ?? "").trim(),
    ).filter((s) => s.length > 0);
    return names.map((name) => ({
      name,
      path: join(dir, name),
      language: "java",
      kind: "maven-module",
    }));
  }

  return fallbackTopLevelDirs(dir, "java");
}

function detectGoModules(dir: string): DetectedModule[] {
  return fallbackTopLevelDirs(dir, "go");
}

function detectRustModules(dir: string): DetectedModule[] {
  return fallbackTopLevelDirs(dir, "rust");
}

function detectPythonModules(dir: string): DetectedModule[] {
  return fallbackTopLevelDirs(dir, "python");
}
