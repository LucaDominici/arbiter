import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { ArbiterPlugin } from "../types/plugin.js";

const VALID_NAME_RE = /^[a-z0-9][a-z0-9-_]*$/;

export async function loadPlugin(
  pkg: string,
  targetDir: string,
): Promise<ArbiterPlugin> {
  const require = createRequire(
    pathToFileURL(join(targetDir, "__arbiter_anchor__.js")).href,
  );
  let entry: string;
  try {
    entry = require.resolve(pkg);
  } catch {
    throw new Error(
      `Plugin "${pkg}" not found in ${targetDir}/node_modules. Install it first: npm install ${pkg}`,
    );
  }
  const rawMod: Record<string, unknown> = (await import(
    pathToFileURL(entry).href
  )) as Record<string, unknown>;
  const plugin = rawMod["default"] ?? rawMod["plugin"];
  validatePluginShape(plugin, pkg);
  return plugin as ArbiterPlugin;
}

function validatePluginShape(plugin: unknown, pkg: string): void {
  if (!plugin || typeof plugin !== "object") {
    throw new Error(`Plugin "${pkg}" must export a default object.`);
  }
  const p = plugin as Record<string, unknown>;
  if (typeof p["name"] !== "string" || !VALID_NAME_RE.test(p["name"])) {
    throw new Error(
      `Plugin "${pkg}" has invalid name "${String(p["name"])}". Must match /^[a-z0-9][a-z0-9-_]*$/`,
    );
  }
  if (p["apiVersion"] !== "1") {
    throw new Error(
      `Plugin "${pkg}" requires apiVersion "1", got "${String(p["apiVersion"])}".`,
    );
  }
  if (typeof p["generate"] !== "function") {
    throw new Error(`Plugin "${pkg}" is missing required generate() function.`);
  }
}
