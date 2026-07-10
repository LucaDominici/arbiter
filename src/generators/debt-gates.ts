// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { mutatePackageJson } from '../utils/pkg.js'
import { injectGradleWiring, safeApplyFromSnippet } from '../utils/gradle.js'
import type { GradleSnippet } from '../utils/gradle.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface DebtGatesGeneratorResult {
  files: WriteResult[]
}

function injectTestScripts(targetDir: string, dryRun: boolean): void {
  mutatePackageJson(targetDir, dryRun, (pkg) => {
    const scripts = (pkg.scripts ?? {}) as Record<string, string>
    // Mirror arbiter's own dogfooded test-tier convention (path-based, not vitest
    // `--project`): the generated vitest.config.ts defines no `projects`, so
    // `vitest run --project <tier>` crashed every generated TS project's gate
    // (#1324). The optional tiers add --passWithNoTests so a greenfield project
    // that has not yet added contract/integration/behavioral tests stays green.
    // #1840 F4 tranche-3: `test:unit` is scoped to `src` (a vitest CLI path
    // filter, same substring-match mechanism the other three tiers already use)
    // — an unscoped `vitest run` also swept up tests/api/**  (api-e2e.ts,
    // INV-126) and tests/e2e/** (playwright-ts.ts a11y), which need `supertest`/
    // `@playwright/test` and a live server. Those never ship as devDependencies
    // (they run via tests/api/run.sh / a dedicated e2e job, not `vitest run`),
    // so a fresh `backend-web-db` init RED'd on `Cannot find package 'supertest'`
    // before any team code was added — surfaced while promoting that archetype's
    // TS fixture to the functional bake-and-run tier.
    const testScripts: Record<string, string> = {
      'test:unit': 'vitest run src',
      'test:contract': 'vitest run --passWithNoTests __tests__/contract',
      'test:integration': 'vitest run --passWithNoTests __tests__/integrations',
      'test:behavioral': 'vitest run --passWithNoTests __tests__/behavioral',
    }
    let changed = false
    for (const [key, value] of Object.entries(testScripts)) {
      if (!scripts[key]) {
        scripts[key] = value
        changed = true
      }
    }
    if (changed) pkg.scripts = scripts
    return changed
  })
}

function injectDepCruiserPackageJson(targetDir: string, dryRun: boolean): void {
  mutatePackageJson(targetDir, dryRun, (pkg) => {
    const scripts = (pkg.scripts ?? {}) as Record<string, string>
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>
    let changed = false
    if (!scripts['check:arch']) {
      scripts['check:arch'] = 'depcruise src'
      pkg.scripts = scripts
      changed = true
    }
    if (!devDeps['dependency-cruiser']) {
      devDeps['dependency-cruiser'] = '^16.0.0'
      pkg.devDependencies = devDeps
      changed = true
    }
    return changed
  })
}

// The toolchain the generated L1/L2 gate actually invokes (tsc, prettier, eslint,
// vitest). Without these declared, a plain `npm install` after `arbiter init`
// leaves the gate's `npx eslint`/`vitest` unresolved (exit 127) — the gate is RED
// on first run for a reason that is arbiter's own under-declaration (B4, #1491).
// Pinned to registry versions (caret) so the install is reproducible (#1314).
const TS_GATE_DEVDEPS: Record<string, string> = {
  typescript: '^5.6.0',
  '@types/node': '^22.0.0',
  prettier: '^3.3.0',
  eslint: '^9.13.0',
  '@eslint/js': '^9.13.0',
  'typescript-eslint': '^8.10.0',
  vitest: '^3.0.0',
  '@vitest/coverage-v8': '^3.0.0',
}

function injectTsGateToolchain(targetDir: string, dryRun: boolean): void {
  mutatePackageJson(targetDir, dryRun, (pkg) => {
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>
    let changed = false
    for (const [name, version] of Object.entries(TS_GATE_DEVDEPS)) {
      // Respect a version the user already pinned — only fill in what is absent so a
      // brownfield project's existing toolchain versions are never overwritten.
      if (!devDeps[name] && !(pkg.dependencies as Record<string, string> | undefined)?.[name]) {
        devDeps[name] = version
        changed = true
      }
    }
    if (changed) pkg.devDependencies = devDeps
    return changed
  })
}

// Gate-essential TypeScript config files — every one is consumed by the generated
// L1 gate (typecheck→tsconfig, format→.prettierrc/.prettierignore, lint→
// eslint.config.mjs, static analysis→eslint.config.static.mjs). Emitted on EVERY
// TS init regardless of enableDebtGates, so init→install→check-all is green (B4).
function emitTsGateScaffold(base: string, data: object, dryRun: boolean): WriteResult[] {
  const files: [string, string][] = [
    // tsconfig.json — TS greenfield baseline (was emitted by the GitHub-gated
    // `root` generator, so non-GitHub inits had no tsconfig → typecheck RED).
    ['tsconfig.json', 'root/tsconfig.json.ejs'],
    ['.prettierrc.json', 'static-analysis/prettierrc.json.ejs'],
    // .prettierignore — scopes `prettier --check .` to the user's source so
    // arbiter's own generated docs/config/hooks do not turn the format gate RED.
    ['.prettierignore', 'static-analysis/prettierignore.ejs'],
    // Flat ESLint configs (v9+): main (lint gate) + isolated static-analysis gate.
    // The legacy eslintrc (.eslintrc-static.json) is retained for compatibility but
    // is no longer consumable by ESLint v9 — the gate now loads the flat configs.
    ['eslint.config.mjs', 'static-analysis/eslint.config.mjs.ejs'],
    ['eslint.config.static.mjs', 'static-analysis/eslint.config.static.mjs.ejs'],
    ['.eslintrc-static.json', 'static-analysis/eslintrc-static.json.ejs'],
  ]
  return files.map(([rel, tmpl]) =>
    writeFile(resolvedPath(base, rel), renderTemplate(tmpl, data), { skipIfExists: true, dryRun }),
  )
}

// Tool/plugin versions the injected root-build wiring pins. Single source —
// the templates no longer carry plugin versions (their plugins {} blocks were
// ILLEGAL inside applied scripts and are gone, #1835-class fix).
const CHECKSTYLE_TOOL_VERSION = '10.21.4' // Java 21 sources need checkstyle 10.12+
const PMD_TOOL_VERSION = '7.10.0' // Java 21 sources need PMD 7
const SPOTBUGS_PLUGIN_VERSION = '6.0.18'
const SPOTLESS_PLUGIN_VERSION = '7.0.3'

/**
 * Spotless brownfield ratchet ref: prefer the remote default branch so a legacy
 * repo passes `spotlessCheck` without reformatting its history — spotless then
 * enforces formatting ONLY on files changed since this ref. `null` (greenfield /
 * no remote) means full enforcement, which is what a fresh repo wants.
 */
function detectSpotlessRatchetRef(targetDir: string): string | null {
  for (const ref of ['origin/main', 'origin/master']) {
    try {
      execFileSync(
        'git',
        ['-C', targetDir, 'rev-parse', '--verify', '--quiet', `refs/remotes/${ref}`],
        {
          stdio: 'ignore',
        },
      )
      return ref
      // FAIL-OPEN-INTENT: ref absent (or no git binary) — try the next candidate; no candidate means greenfield, i.e. full spotless enforcement (the strict default).
    } catch {
      // try next ref
    }
  }
  return null
}

// Wiring split rationale (empirically verified, Gradle 8.8):
//   - plugins MUST be declared in the root plugins {} block (plugins DSL is
//     illegal in applied scripts);
//   - the SpotBugs extension config uses plugin enum types (Effort/Confidence)
//     that applied scripts cannot even reference (classloader isolation), so it
//     lives in the injected block too;
//   - checkstyle/pmd extension blocks point the core plugins at the emitted
//     config files;
//   - spotless.gradle / spotbugs.gradle remain applied scripts (string-only
//     config is classpath-safe), wired via guarded apply(from=...) — a script
//     still carrying the pre-fix plugins {} shape is NOT applied (see
//     safeApplyFromSnippet).

/** Java applies to `java` and the backend lane of `multi`. */
function isJavaLike(config: ProjectConfig): boolean {
  return config.language === 'java' || config.language === 'multi'
}

/**
 * Gate-essential Java scaffold — emitted on EVERY Java+Gradle init (even L1,
 * where enableDebtGates is false) because the generated L1 gate already runs
 * `./gradlew checkstyleMain spotlessCheck test` (#1835-class fix; same B4/#1491
 * rule that moved the TS/python gate-essential scaffold above the guard).
 * No-op for other languages (guard lives here to keep generateDebtGates simple).
 */
function pushJavaGateEssentials(
  results: WriteResult[],
  config: ProjectConfig,
  data: object,
  dryRun: boolean,
): void {
  if (!isJavaLike(config)) return
  const base = config.targetDir
  // Ratchet resolved at scaffold time from the target's actual git state, then
  // baked into spotless.gradle — a brownfield repo (existing origin default
  // branch) gets changed-files-only enforcement, a greenfield repo gets full
  // enforcement.
  const javaData = { ...data, spotlessRatchetFrom: detectSpotlessRatchetRef(base) }
  const files: [string, string][] = [
    [resolvedPath(base, 'config', 'checkstyle.xml'), 'static-analysis/checkstyle.xml.ejs'],
    [resolvedPath(base, 'spotless.gradle'), 'static-analysis/spotless.gradle.ejs'],
  ]
  for (const [path, tmpl] of files) {
    results.push(writeFile(path, renderTemplate(tmpl, javaData), { skipIfExists: true, dryRun }))
  }
  if (config.buildTool !== 'gradle') return
  const snippets: GradleSnippet[] = [
    {
      signature: /(?:^|\n)[ \t]*checkstyle\s*\{/,
      kts: `checkstyle {\n    toolVersion = "${CHECKSTYLE_TOOL_VERSION}"\n    configFile = file("config/checkstyle.xml")\n}`,
      groovy: `checkstyle {\n    toolVersion = '${CHECKSTYLE_TOOL_VERSION}'\n    configFile = file('config/checkstyle.xml')\n}`,
    },
  ]
  const applySpotless = safeApplyFromSnippet(base, 'spotless.gradle')
  if (applySpotless) snippets.push(applySpotless)
  injectGradleWiring(base, dryRun, {
    plugins: [
      { id: 'checkstyle' },
      { id: 'com.diffplug.spotless', version: SPOTLESS_PLUGIN_VERSION },
    ],
    snippets,
  })
}

/** Debt-tier Java scaffold (L2+): pmd + spotbugs configs, wired into the build. */
function pushJavaDebtGates(
  results: WriteResult[],
  config: ProjectConfig,
  data: object,
  dryRun: boolean,
): void {
  if (!isJavaLike(config)) return
  const base = config.targetDir
  const files: [string, string][] = [
    [resolvedPath(base, 'config', 'pmd-ruleset.xml'), 'static-analysis/pmd-ruleset.xml.ejs'],
    [
      resolvedPath(base, 'config', 'spotbugs-exclude.xml'),
      'static-analysis/spotbugs-exclude.xml.ejs',
    ],
    [resolvedPath(base, 'config', 'pitest-setup.md'), 'mutation/pitest-l2-setup.md.ejs'],
    [resolvedPath(base, 'spotbugs.gradle'), 'static-analysis/spotbugs.gradle.ejs'],
    [resolvedPath(base, 'scripts', 'verify-spotbugs.mjs'), 'scripts/verify-spotbugs.mjs.ejs'],
    [resolvedPath(base, 'spotbugs-baseline.json'), 'scripts/spotbugs-baseline.json.ejs'],
  ]
  for (const [path, tmpl] of files) {
    results.push(writeFile(path, renderTemplate(tmpl, data), { skipIfExists: true, dryRun }))
  }
  // Wire the configs into the build — the L2 gate calls ./gradlew pmdMain /
  // spotbugsMain, which only exist once the plugins are actually applied. Maven
  // wiring (pom.xml injection) is a separate concern — the maven gate invokes
  // plugin goals by full coordinates instead.
  if (config.buildTool !== 'gradle') return
  const snippets: GradleSnippet[] = [
    {
      signature: /(?:^|\n)[ \t]*pmd\s*\{/,
      kts: `pmd {\n    toolVersion = "${PMD_TOOL_VERSION}"\n    ruleSetFiles = files("config/pmd-ruleset.xml")\n    ruleSets = listOf()\n}`,
      groovy: `pmd {\n    toolVersion = '${PMD_TOOL_VERSION}'\n    ruleSetFiles = files('config/pmd-ruleset.xml')\n    ruleSets = []\n}`,
    },
    {
      signature: /(?:^|\n)[ \t]*spotbugs\s*\{/,
      kts: `spotbugs {\n    effort.set(com.github.spotbugs.snom.Effort.MAX)\n    reportLevel.set(com.github.spotbugs.snom.Confidence.MEDIUM)\n    excludeFilter.set(file("config/spotbugs-exclude.xml"))\n}`,
      // Groovy needs valueOf(): direct `Confidence.MEDIUM` resolves to the enum
      // constant's INNER CLASS (constants with bodies compile to Confidence$MEDIUM,
      // and Groovy property access on a Class checks inner classes first) —
      // "Cannot set … using an instance of type java.lang.Class". Verified
      // empirically on Gradle 8.8 + spotbugs plugin 6.0.18.
      groovy: `spotbugs {\n    effort = com.github.spotbugs.snom.Effort.valueOf('MAX')\n    reportLevel = com.github.spotbugs.snom.Confidence.valueOf('MEDIUM')\n    excludeFilter = file('config/spotbugs-exclude.xml')\n}`,
    },
  ]
  const applySpotbugs = safeApplyFromSnippet(base, 'spotbugs.gradle')
  if (applySpotbugs) snippets.push(applySpotbugs)
  injectGradleWiring(base, dryRun, {
    plugins: [{ id: 'pmd' }, { id: 'com.github.spotbugs', version: SPOTBUGS_PLUGIN_VERSION }],
    snippets,
  })
}

export function generateDebtGates(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): DebtGatesGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = { ...config, strictnessTier: config.strictnessTier ?? 'practical' }

  // Universal config-lint configs (#1546, closing #1506/#1507). Language-agnostic:
  // every generated repo has non-workflow YAML and/or shell, and the config-lint CI
  // lane + pre-commit hook run at every governance level. Committed + tunable, they
  // are auto-discovered by yamllint/shellcheck — making the rules explicit and
  // project-tunable rather than relying on the relaxed/default fallback. Emitted for
  // ALL archetypes, before any language or enableDebtGates gating.
  for (const [rel, tmpl] of [
    ['.yamllint.yml', 'static-analysis/.yamllint.yml.ejs'],
    ['.shellcheckrc', 'static-analysis/.shellcheckrc.ejs'],
  ] as const) {
    results.push(
      writeFile(resolvedPath(base, rel), renderTemplate(tmpl, data), {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    )
  }

  if (config.language === 'typescript' || config.language === 'multi') {
    injectTestScripts(base, opts.dryRun)
    // Gate-essential TS scaffold — emitted for EVERY TS init (even L1, where
    // enableDebtGates is false) because the generated L1 gate already runs
    // typecheck/format/lint/static-analysis/unit for TS. Without these the gate is
    // RED on first install (B4, #1491). The debt-only extras (knip, dep-cruiser)
    // stay below the enableDebtGates guard.
    results.push(...emitTsGateScaffold(base, data, opts.dryRun))
    injectTsGateToolchain(base, opts.dryRun)
  }

  // Gate-essential Java scaffold — even L1 runs checkstyleMain + spotlessCheck.
  // (No-op for non-Java languages; guard inside.)
  pushJavaGateEssentials(results, config, data, opts.dryRun)

  if (config.language === 'python') {
    // Gate-essential Python scaffold — emitted on EVERY Python init (even L1, where
    // enableDebtGates is false) because the generated L1 gate runs ruff (lint +
    // format) and pytest. ruff.toml supplies arbiter's lint config; requirements-
    // dev.txt declares the toolchain the gate invokes (B4, #1491).
    results.push(
      writeFile(
        resolvedPath(base, 'ruff.toml'),
        renderTemplate('static-analysis/ruff.toml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, 'requirements-dev.txt'),
        renderTemplate('static-analysis/requirements-dev.txt.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  if (!config.enableDebtGates) return { files: results }

  if (config.language === 'typescript' || config.language === 'multi') {
    results.push(
      writeFile(
        resolvedPath(base, 'knip.json'),
        renderTemplate('static-analysis/knip.json.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, '.dependency-cruiser.cjs'),
        renderTemplate('static-analysis/.dependency-cruiser.cjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    injectDepCruiserPackageJson(base, opts.dryRun)
  }

  if (config.language === 'rust') {
    results.push(
      writeFile(
        resolvedPath(base, 'rustfmt.toml'),
        renderTemplate('static-analysis/rustfmt.toml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  if (config.language === 'go') {
    results.push(
      writeFile(
        resolvedPath(base, '.golangci.yml'),
        renderTemplate('static-analysis/.golangci.yml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  pushJavaDebtGates(results, config, data, opts.dryRun)

  // NOTE: ruff.toml + requirements-dev.txt for Python are emitted above, before the
  // enableDebtGates guard, so the L1 gate (ruff/pytest) has its config on first run.

  if (config.language === 'kotlin') {
    pushKotlinDebtGates(results, base, data, opts.dryRun)
  }

  return { files: results }
}

function pushKotlinDebtGates(
  results: WriteResult[],
  base: string,
  data: object,
  dryRun: boolean,
): void {
  results.push(
    writeFile(
      resolvedPath(base, 'config', 'detekt', 'detekt.yml'),
      renderTemplate('static-analysis/detekt.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  )
}
