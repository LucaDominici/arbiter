#!/usr/bin/env node
/**
 * refresh-matrix.mjs
 *
 * Fetches latest stable versions from public APIs and updates
 * src/compatibility/matrix.json if any minimum floors should be bumped.
 *
 * Floor policy: when a new major version ships, bump floor to (latest - 1)
 * so consumers have one major version of runway. Node.js: LTS releases only.
 *
 * Usage:
 *   node scripts/refresh-matrix.mjs          # dry-run (print diff, no write)
 *   node scripts/refresh-matrix.mjs --apply  # write updated matrix.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const MATRIX_PATH = join(__dir, "../src/compatibility/matrix.json");

const apply = process.argv.includes("--apply");

// ---------------------------------------------------------------------------
// Fetchers — each returns { major, minor } for the latest stable release
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

/** Node.js: latest LTS major */
async function latestNode() {
  const releases = await fetchJson("https://nodejs.org/dist/index.json");
  const lts = releases.filter((r) => r.lts !== false);
  if (lts.length === 0) return null;
  const major = Math.max(...lts.map((r) => parseInt(r.version.slice(1), 10)));
  return { major, minor: 0 };
}

/** npm: latest from registry */
async function latestNpm() {
  const data = await fetchJson("https://registry.npmjs.org/npm/latest");
  const [major, minor] = data.version.split(".").map(Number);
  return { major, minor };
}

/** Gradle: current stable */
async function latestGradle() {
  const data = await fetchJson("https://services.gradle.org/versions/current");
  const [major, minor] = data.version.split(".").map(Number);
  return { major, minor };
}

/** Maven: latest from Maven Central solr */
async function latestMaven() {
  const url =
    "https://search.maven.org/solrsearch/select?q=g:org.apache.maven+a:apache-maven&core=gav&rows=1&wt=json&sort=version+desc";
  const data = await fetchJson(url);
  const version = data?.response?.docs?.[0]?.v;
  if (!version) return null;
  const [major, minor] = version.split(".").map(Number);
  return { major, minor };
}

/** Rust: latest stable from GitHub releases */
async function latestRust() {
  const data = await fetchJson(
    "https://api.github.com/repos/rust-lang/rust/releases/latest",
  );
  const tag = data.tag_name; // e.g. "1.78.0"
  const [major, minor] = tag.split(".").map(Number);
  return { major, minor };
}

/** Go: latest stable from go.dev */
async function latestGo() {
  const releases = await fetchJson("https://go.dev/dl/?mode=json");
  const stable = releases.filter((r) => r.stable && r.version.startsWith("go"));
  if (stable.length === 0) return null;
  const version = stable[0].version.slice(2); // strip "go"
  const [major, minor] = version.split(".").map(Number);
  return { major, minor };
}

/** Python: latest 3.x from endoflife.date */
async function latestPython() {
  const cycles = await fetchJson("https://endoflife.date/api/python.json");
  const py3 = cycles.filter((c) => c.cycle.startsWith("3."));
  if (py3.length === 0) return null;
  const [, minor] = py3[0].cycle.split(".").map(Number);
  return { major: 3, minor };
}

/** pip: latest from PyPI */
async function latestPip() {
  const data = await fetchJson("https://pypi.org/pypi/pip/json");
  const [major, minor] = data.info.version.split(".").map(Number);
  return { major, minor };
}

/** ruff: latest from PyPI */
async function latestRuff() {
  const data = await fetchJson("https://pypi.org/pypi/ruff/json");
  const [major, minor] = data.info.version.split(".").map(Number);
  return { major, minor };
}

/** Kotlin: latest from GitHub releases */
async function latestKotlin() {
  const data = await fetchJson(
    "https://api.github.com/repos/JetBrains/kotlin/releases/latest",
  );
  const tag = data.tag_name.replace(/^v/, ""); // e.g. "2.0.0"
  const [major, minor] = tag.split(".").map(Number);
  return { major, minor };
}

/** Java (Adoptium LTS): latest LTS major from Eclipse Temurin */
async function latestJava() {
  const data = await fetchJson(
    "https://api.adoptium.net/v3/info/available_releases",
  );
  const lts = data.available_lts_releases ?? [];
  if (lts.length === 0) return null;
  const major = Math.max(...lts);
  return { major, minor: 0 };
}

// ---------------------------------------------------------------------------
// Floor bump logic
// ---------------------------------------------------------------------------

/**
 * Parse the numeric floor from a range string like ">=18", ">=3.10", ">=0.4".
 * Returns { major, minor } or null if unparseable.
 */
function parseFloor(range) {
  const m = range.match(/^>=(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2] ?? 0) };
}

/**
 * Given current floor and latest stable version, return new floor string or
 * null if no bump is warranted.
 *
 * Policy: bump floor if latest_major > floor_major + 1
 * (i.e., floor is more than one major behind latest).
 * New floor = latest_major - 1 (keep one major runway).
 *
 * Exception: for patch-bumps within same major (ruff 0.x) use minor:
 * bump floor minor if latest_minor > floor_minor + 4 (conservative).
 */
function computeNewFloor(tool, currentRange, latest) {
  const floor = parseFloor(currentRange);
  if (!floor || !latest) return null;

  // Zero-major tools (ruff 0.x): use minor bumping
  if (floor.major === 0 && latest.major === 0) {
    if (latest.minor > floor.minor + 4) {
      return `>=0.${latest.minor - 2}`;
    }
    return null;
  }

  // Standard: bump if floor is 2+ majors behind latest
  if (latest.major > floor.major + 1) {
    const newMajor = latest.major - 1;
    return `>=${newMajor}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const TOOL_FETCHERS = {
  node: latestNode,
  npm: latestNpm,
  java: latestJava,
  gradle: latestGradle,
  mvn: latestMaven,
  rustc: latestRust,
  cargo: latestRust,
  go: latestGo,
  python3: latestPython,
  pip: latestPip,
  ruff: latestRuff,
  kotlin: latestKotlin,
};

async function main() {
  const matrix = JSON.parse(readFileSync(MATRIX_PATH, "utf8"));

  // Collect unique tools across all stacks
  const tools = new Set();
  for (const entries of Object.values(matrix)) {
    for (const { tool } of entries) tools.add(tool);
  }

  console.log("Fetching latest stable versions...");
  const latestMap = {};
  await Promise.allSettled(
    [...tools].map(async (tool) => {
      const fetcher = TOOL_FETCHERS[tool];
      if (!fetcher) return;
      try {
        latestMap[tool] = await fetcher();
        console.log(
          `  ${tool}: ${latestMap[tool] ? `${latestMap[tool].major}.${latestMap[tool].minor}` : "n/a"}`,
        );
      } catch (err) {
        console.warn(`  ${tool}: fetch failed — ${err.message}`);
      }
    }),
  );

  let changed = false;
  const updated = structuredClone(matrix);

  for (const [stack, entries] of Object.entries(updated)) {
    for (const entry of entries) {
      const latest = latestMap[entry.tool];
      const newRange = computeNewFloor(entry.tool, entry.range, latest);
      if (newRange && newRange !== entry.range) {
        console.log(`  [${stack}] ${entry.tool}: ${entry.range} → ${newRange}`);
        entry.range = newRange;
        changed = true;
      }
    }
  }

  if (!changed) {
    console.log("\nMatrix is up-to-date. No changes.");
    return;
  }

  const output = JSON.stringify(updated, null, 2) + "\n";

  if (apply) {
    writeFileSync(MATRIX_PATH, output, "utf8");
    console.log("\nMatrix written to", MATRIX_PATH);
  } else {
    console.log("\nDry run — pass --apply to write changes.");
    console.log("New matrix.json would be:");
    console.log(output);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
