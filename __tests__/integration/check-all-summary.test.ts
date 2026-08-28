import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import { loadGateRegistry } from '../../src/generators/check-all.js'

describe('check-all.mjs integration — summary table (#210, CANON-07)', () => {
  it('rendered check-all.mjs contains summary table logic', () => {
    const cfg = makeConfig('/tmp/test', { coverageEnabled: false }) as unknown as Record<
      string,
      unknown
    >
    // #2041: check-all.mjs.ejs now iterates a `gates` local computed via
    // loadGateRegistry() — every render call site must supply it (see
    // __tests__/gates/gate-registry.test.ts / check-all-render.test.ts).
    // gate-registry.yml.ejs itself always required coverageThreshold (pre-#2041) —
    // makeConfig() doesn't default it, so mirror baseData()'s enrichment here too.
    const gateData = { ...cfg, coverageThreshold: 80 }
    const rendered = renderTemplate('scripts/check-all.mjs.ejs', {
      ...gateData,
      gates: loadGateRegistry(gateData),
    })
    expect(rendered).toContain('=== Summary ===')
    expect(rendered).toContain('Failed checks:')
    expect(rendered).toContain("r.status === 'FAIL' || r.status === 'TIMEOUT'")
    expect(rendered).toContain('`- ${r.name} (${r.status})`')
    expect(rendered).toContain('IS_CI')
    expect(rendered).toContain('Elapsed')
    expect(rendered).toContain('Total')
    // #351 (CANON-01): stripAnsi + ::error:: live in the helper module now.
    expect(rendered).toContain("from './lib/run-helpers.mjs'")
    const lib = renderTemplate('scripts/lib/run-helpers.mjs.ejs', cfg)
    expect(lib).toContain('::error::')
    expect(lib).toContain('stripAnsi')
    expect(lib).toContain("status: 'TIMEOUT'")
    expect(lib).toContain('availableParallelism')
  })

  it('summary table appears in output of a minimal check-all script (passing)', () => {
    // Build a minimal check-all stub with the same summary-table logic
    // but only a trivial echo check — avoids recursive npm test invocation.
    const stub = `
import { spawnSync } from "node:child_process";

let failed = 0;
const IS_CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const NO_COLOR = IS_CI || process.env.NO_COLOR === "1";

function stripAnsi(str) {
  return str.replace(/\\x1b\\[[0-9;]*m/g, "");
}

const results = [];

function runCheck(name, cmd, args) {
  const start = Date.now();
  process.stdout.write(\`[CHECK] \${name} ... \`);
  const r = spawnSync(cmd, args, { encoding: "utf-8", shell: false });
  const elapsed = Date.now() - start;

  if (r.error && r.error.code === "ENOENT") {
    console.log(\`FAIL (\${elapsed}ms)\`);
    if (IS_CI) console.log(\`::error::\${name}::command not found: \${cmd}\`);
    results.push({ name, status: "FAIL", elapsed });
    failed++;
    return;
  }

  if (r.status === 0) {
    console.log(\`PASS (\${elapsed}ms)\`);
    results.push({ name, status: "PASS", elapsed });
    return;
  }

  console.log(\`FAIL (exit \${r.status}, \${elapsed}ms)\`);
  if (IS_CI) console.log(\`::error::\${name}::exit \${r.status}\`);
  if (r.stdout) process.stdout.write(NO_COLOR ? stripAnsi(r.stdout) : r.stdout);
  if (r.stderr) process.stderr.write(NO_COLOR ? stripAnsi(r.stderr) : r.stderr);
  results.push({ name, status: "FAIL", elapsed });
  failed++;
}

runCheck("echo test", "node", ["-e", "process.exit(0)"]);

// Summary
console.log("");
console.log("=== Summary ===");
console.log("");
const nameWidth = Math.max(6, ...results.map((r) => r.name.length));
const header = \`\${"Check".padEnd(nameWidth)}  Status  Elapsed\`;
const divider = "-".repeat(header.length);
console.log(header);
console.log(divider);
let totalElapsed = 0;
for (const r of results) {
  totalElapsed += r.elapsed;
  console.log(\`\${r.name.padEnd(nameWidth)}  \${r.status.padEnd(6)}  \${r.elapsed}ms\`);
}
console.log(divider);
console.log(\`\${"Total".padEnd(nameWidth)}          \${totalElapsed}ms\`);
console.log("");

if (failed > 0) {
  console.error(\`=== FAILED: \${failed} check(s) ===\\n\`);
  process.exit(1);
} else {
  console.log("=== ALL PASSED ===\\n");
}
`

    const dir = mkdtempSync(join(tmpdir(), 'arbiter-check-all-test-'))
    try {
      const stubPath = join(dir, 'check-all.mjs')
      writeFileSync(stubPath, stub, 'utf-8')

      const result = spawnSync('node', [stubPath], {
        encoding: 'utf-8',
        shell: false,
        timeout: 10_000,
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('=== Summary ===')
      expect(result.stdout).toContain('Check')
      expect(result.stdout).toContain('Elapsed')
      expect(result.stdout).toContain('Total')
      expect(result.stdout).toContain('PASS')
      expect(result.stdout).toContain('=== ALL PASSED ===')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('::error:: annotation emitted in CI mode when check fails', () => {
    const stub = `
import { spawnSync } from "node:child_process";

let failed = 0;
const IS_CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const NO_COLOR = IS_CI || process.env.NO_COLOR === "1";

function stripAnsi(str) {
  return str.replace(/\\x1b\\[[0-9;]*m/g, "");
}

const results = [];

function runCheck(name, cmd, args) {
  const start = Date.now();
  process.stdout.write(\`[CHECK] \${name} ... \`);
  const r = spawnSync(cmd, args, { encoding: "utf-8", shell: false });
  const elapsed = Date.now() - start;

  if (r.status === 0) {
    console.log(\`PASS (\${elapsed}ms)\`);
    results.push({ name, status: "PASS", elapsed });
    return;
  }

  console.log(\`FAIL (exit \${r.status}, \${elapsed}ms)\`);
  if (IS_CI) console.log(\`::error::\${name}::exit \${r.status}\`);
  results.push({ name, status: "FAIL", elapsed });
  failed++;
}

runCheck("failing step", "node", ["-e", "process.exit(1)"]);

// Summary
console.log("");
console.log("=== Summary ===");
console.log("");
const nameWidth = Math.max(6, ...results.map((r) => r.name.length));
const header = \`\${"Check".padEnd(nameWidth)}  Status  Elapsed\`;
const divider = "-".repeat(header.length);
console.log(header);
console.log(divider);
let totalElapsed = 0;
for (const r of results) {
  totalElapsed += r.elapsed;
  console.log(\`\${r.name.padEnd(nameWidth)}  \${r.status.padEnd(6)}  \${r.elapsed}ms\`);
}
console.log(divider);
console.log(\`\${"Total".padEnd(nameWidth)}          \${totalElapsed}ms\`);
console.log("");

if (failed > 0) {
  const failedResults = results.filter((r) => r.status === "FAIL");
  console.error(\`=== FAILED: \${failed} check(s) ===\`);
  console.error("Failed checks:");
  for (const r of failedResults) console.error(\`- \${r.name}\`);
  console.error("");
  process.exit(1);
}
`

    const dir = mkdtempSync(join(tmpdir(), 'arbiter-check-all-ci-test-'))
    try {
      const stubPath = join(dir, 'check-all-ci.mjs')
      writeFileSync(stubPath, stub, 'utf-8')

      const result = spawnSync('node', [stubPath], {
        encoding: 'utf-8',
        shell: false,
        timeout: 10_000,
        env: { ...process.env, GITHUB_ACTIONS: 'true', NO_COLOR: '1' },
      })

      expect(result.status).toBe(1)
      const combined = result.stdout + result.stderr
      expect(combined).toContain('::error::failing step::exit 1')
      expect(combined).toContain('=== Summary ===')
      expect(combined).toContain('Failed checks:')
      expect(combined).toContain('- failing step')
      expect(combined).toContain('FAIL')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('real run helper emits CI failure annotation before verbose child output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-run-helper-order-'))
    try {
      const helperUrl = pathToFileURL(resolve('scripts/lib/run-helpers.mjs')).href
      const stubPath = join(dir, 'run-helper-order.mjs')
      writeFileSync(
        stubPath,
        `
import { runCheck } from ${JSON.stringify(helperUrl)};

runCheck('verbose failing step', 'node', [
  '-e',
  "process.stdout.write('child-output-marker\\\\n'); process.exit(1)",
]);
`,
        'utf-8',
      )

      const result = spawnSync('node', [stubPath], {
        encoding: 'utf-8',
        shell: false,
        timeout: 10_000,
        env: { ...process.env, GITHUB_ACTIONS: 'true', NO_COLOR: '1' },
      })

      expect(result.status).toBe(0)
      const combined = result.stdout + result.stderr
      const annotationIndex = combined.indexOf('::error::verbose failing step::exit 1')
      const childOutputIndex = combined.indexOf('child-output-marker')
      expect(annotationIndex).toBeGreaterThanOrEqual(0)
      expect(childOutputIndex).toBeGreaterThanOrEqual(0)
      expect(annotationIndex).toBeLessThan(childOutputIndex)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
