// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile } from './fs.js'
import { getLogger } from './logger.js'

/**
 * Idempotent root-build injector for Gradle projects (#1835-class fix: the Java
 * gold tooling was scaffolded as standalone config files but never WIRED into the
 * build, so the generated gate called tasks — checkstyleMain, spotlessCheck,
 * spotbugsMain, pmdMain, pitest — that did not exist).
 *
 * Why injection into the ROOT build script (and not `apply from:` alone):
 *   1. Gradle FORBIDS a `plugins {}` DSL block inside an applied script — the
 *      plugins DSL is only valid in the root build script, so third-party plugins
 *      (spotless, spotbugs, pitest) MUST be declared here.
 *   2. Applied script plugins do NOT share the root build's plugin classpath
 *      (script-plugin classloader isolation — verified empirically: an applied
 *      Groovy script cannot even `import com.github.spotbugs.snom.Effort`), so
 *      enum-typed extension config (SpotBugs effort/reportLevel) must also live
 *      in the root build script.
 *
 * Brownfield contract (arbiter operates on EXISTING builds — never overwrites):
 *   - every plugin / config block / dependency is added ONLY when its presence
 *     signature is absent from the build file (fill-gaps, never duplicate);
 *   - a re-run leaves the file byte-identical (idempotent, mirrors
 *     `mutatePackageJson`);
 *   - config lines land inside one marker-delimited block appended at EOF, so
 *     operators can see at a glance what arbiter manages;
 *   - conservative by design: when a signature matches user-authored config
 *     (e.g. an existing `checkstyle {}` block), arbiter respects it and skips.
 *
 * Writes are routed through the `utils/fs.ts` `writeFile` façade (atomic
 * temp-file + rename) — a crash mid-write can never truncate the user's build
 * script, the worst file to leave half-written after package.json.
 */

export type GradleDsl = 'kts' | 'groovy'

export interface GradlePluginSpec {
  /** Plugin id — core (`checkstyle`, `pmd`) or marketplace (`com.diffplug.spotless`). */
  id: string
  /** Marketplace plugin version. Omit for Gradle core plugins. */
  version?: string
}

export interface GradleSnippet {
  /** When this matches the build file, the snippet is considered already wired. */
  signature: RegExp
  kts: string
  groovy: string
}

export interface GradleDependencySpec {
  /** Maven coordinate `group:artifact:version` (presence-checked on `group:artifact`). */
  coordinate: string
  /** Dependency configuration (default `testImplementation`). */
  configuration?: string
}

export interface GradleWiringRequest {
  plugins?: GradlePluginSpec[]
  snippets?: GradleSnippet[]
  dependencies?: GradleDependencySpec[]
}

export interface GradleWiringResult {
  changed: boolean
  buildFile: string | null
}

const MARKER_BEGIN = '// >>> arbiter:java-tooling (managed — `arbiter update` re-adds missing lines)'
const MARKER_END = '// <<< arbiter:java-tooling'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Root build script: prefer Kotlin DSL when both exist (rare; single-file expected). */
export function findRootBuildFile(targetDir: string): string | null {
  for (const name of ['build.gradle.kts', 'build.gradle']) {
    const p = join(targetDir, name)
    if (existsSync(p)) return p
  }
  return null
}

/** Match a top-level `plugins {` block; returns [blockStart, openBraceIdx] or null. */
function findPluginsBlock(content: string): { open: number; close: number } | null {
  const m = /(?:^|\n)[ \t]*plugins\s*\{/.exec(content)
  if (!m) return null
  const open = m.index + m[0].length - 1
  const close = matchBrace(content, open)
  return close < 0 ? null : { open, close }
}

/** Index of the `}` closing the `{` at openIdx (naive nesting count), or -1. */
function matchBrace(content: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < content.length; i++) {
    if (content[i] === '{') depth++
    else if (content[i] === '}' && --depth === 0) return i
  }
  return -1
}

/**
 * True when the plugin is already applied in ANY recognizable form: quoted id
 * anywhere (`id("x")`, `id 'x'`, `apply(plugin = "x")`, version-catalog TOML
 * references keep the id string too), or — for unquoted core-plugin accessors in
 * Kotlin DSL (`checkstyle`, `pmd` as bare identifiers) — a word match inside the
 * plugins block. Conservative on purpose: a false "present" leaves a gap the
 * operator can close by hand; a false "absent" would duplicate a declaration and
 * break the build.
 */
function hasPlugin(content: string, pluginsBlock: string, id: string): boolean {
  if (content.includes(`"${id}"`) || content.includes(`'${id}'`)) return true
  return new RegExp(`(?:^|[^\\w.])${escapeRegExp(id)}(?:[^\\w.]|$)`).test(pluginsBlock)
}

function pluginLine(dsl: GradleDsl, spec: GradlePluginSpec, indent: string): string {
  if (dsl === 'kts') {
    const base = `${indent}id("${spec.id}")`
    return spec.version ? `${base} version "${spec.version}"` : base
  }
  const base = `${indent}id '${spec.id}'`
  return spec.version ? `${base} version '${spec.version}'` : base
}

/**
 * Offset where a NEW `plugins {}` block may legally start: after the leading
 * comment/import prologue and after a `buildscript {}` block when present
 * (Gradle: only imports/buildscript may precede `plugins {}`).
 */
function pluginsBlockInsertionOffset(content: string): number {
  const lines = content.split('\n')
  let offset = 0
  let inBlockComment = false
  for (const line of lines) {
    const trimmed = line.trim()
    const lineSpan = line.length + 1
    if (inBlockComment) {
      offset += lineSpan
      if (trimmed.includes('*/')) inBlockComment = false
      continue
    }
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('import ')) {
      offset += lineSpan
      continue
    }
    if (trimmed.startsWith('/*')) {
      offset += lineSpan
      if (!trimmed.includes('*/')) inBlockComment = true
      continue
    }
    if (/^buildscript\s*\{/.test(trimmed)) {
      const open = content.indexOf('{', offset)
      const close = matchBrace(content, open)
      if (close < 0) return offset
      // Skip past the buildscript block's closing line.
      const nl = content.indexOf('\n', close)
      return nl < 0 ? content.length : nl + 1
    }
    return offset
  }
  return offset
}

function ensurePlugins(content: string, dsl: GradleDsl, plugins: GradlePluginSpec[]): string {
  if (plugins.length === 0) return content
  const block = findPluginsBlock(content)
  const blockSrc = block ? content.slice(block.open, block.close + 1) : ''
  const missing = plugins.filter((p) => !hasPlugin(content, blockSrc, p.id))
  if (missing.length === 0) return content

  if (block) {
    // Reuse the indentation of the first existing plugin line, else 4 spaces.
    const inner = content.slice(block.open + 1, block.close)
    const indent = /\n([ \t]+)\S/.exec(inner)?.[1] ?? '    '
    const lines = missing.map((p) => pluginLine(dsl, p, indent)).join('\n')
    return content.slice(0, block.open + 1) + '\n' + lines + content.slice(block.open + 1)
  }

  const lines = missing.map((p) => pluginLine(dsl, p, '    ')).join('\n')
  const newBlock = `plugins {\n${lines}\n}\n\n`
  const at = pluginsBlockInsertionOffset(content)
  return content.slice(0, at) + newBlock + content.slice(at)
}

function dependencySnippet(dsl: GradleDsl, dep: GradleDependencySpec): string {
  const conf = dep.configuration ?? 'testImplementation'
  // Kotlin DSL: string-invoke form — the typed accessor (`testImplementation(...)`)
  // only exists when the `java` plugin is declared via the plugins DSL, which a
  // brownfield build may not do. String-invoke always compiles.
  if (dsl === 'kts') return `dependencies { "${conf}"("${dep.coordinate}") }`
  return `dependencies { ${conf} '${dep.coordinate}' }`
}

function dependencyAsSnippet(dep: GradleDependencySpec): GradleSnippet {
  const groupArtifact = dep.coordinate.split(':').slice(0, 2).join(':')
  return {
    signature: new RegExp(escapeRegExp(groupArtifact)),
    kts: dependencySnippet('kts', dep),
    groovy: dependencySnippet('groovy', dep),
  }
}

function ensureSnippets(content: string, dsl: GradleDsl, snippets: GradleSnippet[]): string {
  const missing = snippets.filter((s) => !s.signature.test(content))
  if (missing.length === 0) return content
  const body = missing.map((s) => (dsl === 'kts' ? s.kts : s.groovy)).join('\n\n')

  const beginIdx = content.indexOf(MARKER_BEGIN)
  const endIdx = beginIdx >= 0 ? content.indexOf(MARKER_END, beginIdx) : -1
  if (beginIdx >= 0 && endIdx >= 0) {
    // Fill gaps inside the existing managed block, just above the end marker.
    return content.slice(0, endIdx) + body + '\n' + content.slice(endIdx)
  }
  return `${content.replace(/\n*$/, '')}\n\n${MARKER_BEGIN}\n${body}\n${MARKER_END}\n`
}

/**
 * `apply(from = <relPath>)` snippet, or `null` when wiring would BREAK the build:
 * the applied script is absent, or still carries a `plugins {}` block (the
 * pre-fix template shape — Gradle rejects the plugins DSL in applied scripts, so
 * pointing the root build at such a file turns a dormant scaffold into a hard
 * build failure). A user-modified script is withheld from template fixes
 * (#1344), so this guard re-checks the ON-DISK content, not the template.
 */
export function safeApplyFromSnippet(targetDir: string, relPath: string): GradleSnippet | null {
  const scriptPath = join(targetDir, relPath)
  if (!existsSync(scriptPath)) return null
  let script: string
  try {
    script = readFileSync(scriptPath, 'utf-8')
  } catch {
    return null
  }
  if (/(?:^|\n)[ \t]*plugins\s*\{/.test(script)) {
    getLogger().warn(
      'gradle.apply_from_withheld',
      { path: scriptPath },
      `gradle wiring: NOT applying ${relPath} — it contains a plugins {} block, which Gradle ` +
        `forbids in applied scripts. Remove the block (or re-generate via arbiter update) and re-run.`,
    )
    return null
  }
  return {
    signature: new RegExp(`apply[^\\n]*["']${escapeRegExp(relPath)}["']`),
    kts: `apply(from = "${relPath}")`,
    groovy: `apply from: '${relPath}'`,
  }
}

/**
 * Single read-modify-write choke-point for a target project's root Gradle build
 * script (the `mutatePackageJson` of the JVM lane). No-op when `dryRun` is set
 * or no root build script exists; idempotent re-runs leave the file
 * byte-identical.
 */
export function injectGradleWiring(
  targetDir: string,
  dryRun: boolean,
  req: GradleWiringRequest,
): GradleWiringResult {
  if (dryRun) return { changed: false, buildFile: findRootBuildFile(targetDir) }
  const buildFile = findRootBuildFile(targetDir)
  if (!buildFile) {
    getLogger().warn(
      'gradle.no_build_file',
      { targetDir },
      'gradle wiring: no build.gradle(.kts) found at project root — tooling left unwired',
    )
    return { changed: false, buildFile: null }
  }
  let content: string
  try {
    content = readFileSync(buildFile, 'utf-8')
  } catch (err) {
    getLogger().warn(
      'gradle.read_failed',
      { path: buildFile, err: String(err) },
      'gradle wiring: failed to read root build script',
    )
    return { changed: false, buildFile }
  }
  const original = content
  const dsl: GradleDsl = buildFile.endsWith('.kts') ? 'kts' : 'groovy'

  content = ensurePlugins(content, dsl, req.plugins ?? [])
  const snippets = [
    ...(req.snippets ?? []),
    ...(req.dependencies ?? []).map(dependencyAsSnippet),
  ]
  content = ensureSnippets(content, dsl, snippets)

  if (content === original) return { changed: false, buildFile }
  writeFile(buildFile, content, { dryRun })
  return { changed: true, buildFile }
}
