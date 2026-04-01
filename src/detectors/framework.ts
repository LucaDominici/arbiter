import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Language } from "../wizard/types.js";

export function detectFramework(
  dir: string,
  language: Language,
): string | null {
  if (language === "typescript") {
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
  }

  if (language === "rust") {
    if (existsSync(join(dir, "src-tauri"))) return "tauri";
    return "rust";
  }

  if (language === "java") {
    const buildFile =
      readFileSafe(join(dir, "build.gradle")) +
      readFileSafe(join(dir, "pom.xml"));
    if (buildFile.includes("spring-boot")) return "spring-boot";
    if (buildFile.includes("quarkus")) return "quarkus";
    return "java";
  }

  return null;
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
