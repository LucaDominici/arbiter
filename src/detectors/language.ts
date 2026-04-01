import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Language } from "../wizard/types.js";

export function detectLanguage(dir: string): Language {
  if (existsSync(join(dir, "package.json"))) return "typescript";
  if (existsSync(join(dir, "Cargo.toml"))) return "rust";
  if (
    existsSync(join(dir, "pom.xml")) ||
    existsSync(join(dir, "build.gradle")) ||
    existsSync(join(dir, "build.gradle.kts"))
  )
    return "java";
  if (existsSync(join(dir, "go.mod"))) return "go";
  if (
    existsSync(join(dir, "pyproject.toml")) ||
    existsSync(join(dir, "setup.py")) ||
    existsSync(join(dir, "requirements.txt"))
  )
    return "python";
  return "unknown";
}
