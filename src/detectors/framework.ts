import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Archetype, Language } from "../wizard/types.js";

export function detectFramework(
  dir: string,
  language: Language,
): string | null {
  if (language === "typescript" || language === "multi")
    return detectTypescriptFramework(dir);
  if (language === "rust") return detectRustFramework(dir);
  if (language === "java") return detectJavaFramework(dir);
  return null;
}

function detectTypescriptFramework(dir: string): string | null {
  const pkg = readPackageJson(dir);
  const deps = getAllDeps(pkg);
  const hasTauri = existsSync(join(dir, "src-tauri"));
  const hasVue = deps.has("vue");
  const hasReact = deps.has("react");
  const hasExpress = deps.has("express");
  const hasNext = deps.has("next");
  const hasFastify = deps.has("fastify");

  if (hasTauri && hasReact) return "tauri+react";
  if (hasTauri && hasVue) return "tauri+vue";
  if (hasTauri) return "tauri";
  if (hasNext) return "next";
  if (hasExpress && hasReact) return "express+react";
  if (hasExpress && hasVue) return "express+vue";
  if (hasExpress) return "express";
  if (hasFastify) return "fastify";
  if (hasVue) return "vue";
  if (hasReact) return "react";
  return null;
}

function detectRustFramework(dir: string): string | null {
  if (existsSync(join(dir, "src-tauri"))) return "tauri";
  return null;
}

function detectJavaFramework(dir: string): string {
  const buildFile =
    readFileSafe(join(dir, "build.gradle")) +
    readFileSafe(join(dir, "pom.xml"));
  if (buildFile.includes("spring-boot")) return "spring-boot";
  if (buildFile.includes("quarkus")) return "quarkus";
  return "java";
}

function readPackageJson(dir: string): Record<string, unknown> {
  try {
    return JSON.parse(
      readFileSync(join(dir, "package.json"), "utf-8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getAllDeps(pkg: Record<string, unknown>): Set<string> {
  const deps = new Set<string>();
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const d = pkg[key];
    if (typeof d === "object" && d !== null) {
      for (const name of Object.keys(d)) deps.add(name);
    }
  }
  return deps;
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// Maps a framework slug to an archetype for languages where heuristics are reliable.
// Keyed by `${language}:${framework}`. Languages without a reliable mapping (go, python,
// unknown) are not present — callers default to "library". See ADR-021.
const FRAMEWORK_ARCHETYPE_MAP: ReadonlyMap<string, Archetype> = new Map([
  ["java:spring-boot", "backend-web-db"],
  ["java:quarkus", "backend-web-db"],
  ["typescript:next", "backend-web-db"],
  ["typescript:express", "backend-web-db"],
  ["typescript:express+react", "backend-web-db"],
  ["typescript:express+vue", "backend-web-db"],
  ["typescript:fastify", "backend-web-db"],
  ["typescript:tauri+react", "frontend-spa"],
  ["typescript:tauri+vue", "frontend-spa"],
  ["typescript:tauri", "frontend-spa"],
  ["typescript:react", "frontend-spa"],
  ["typescript:vue", "frontend-spa"],
  ["rust:tauri", "frontend-spa"],
]);

// Languages where "no matching framework" still yields a reliable archetype.
const LANGUAGE_FALLBACK_ARCHETYPE: ReadonlyMap<Language, Archetype> = new Map([
  ["java", "library"],
  ["typescript", "library"],
  ["rust", "library"],
  ["multi", "backend-web-db"],
]);

/**
 * Infer a project archetype from the detected language and framework.
 * Returns null when the heuristic is unreliable — callers should default to "library".
 *
 * The archetype is separate from language: a TypeScript CLI and a Python CLI share
 * archetype invariants. See ADR-021.
 */
export function detectArchetypeHint(
  _dir: string,
  language: Language,
  framework: string | null,
): Archetype | null {
  if (framework !== null) {
    const key = `${language}:${framework}`;
    const mapped = FRAMEWORK_ARCHETYPE_MAP.get(key);
    if (mapped !== undefined) return mapped;
  }
  return LANGUAGE_FALLBACK_ARCHETYPE.get(language) ?? null;
}
