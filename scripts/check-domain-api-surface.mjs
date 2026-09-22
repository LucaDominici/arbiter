#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — domain<->API surface-completeness gate (INV-125)
//
// CATALOG: INV-125 enforcement. Reads domain-api-surface.json at repo root; fails when a
// CATALOG:   persisted domain field is absent from both request and response schemas.
// CATALOG:   Write-unreachable/read-invisible failures were observed in a prior internal project.
// CATALOG:   Rejected fold-in into contract-testing/check-provider-states.mjs (different axis).
// CATALOG:   A missing or malformed manifest is an explicit policy or operational failure.
//
// Exit codes per INV-53: 0=PASS, 1=policy failure, 2=schema/parse error
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA = 'arbiter-domain-api-surface-v1'
const ALLOWLIST = {
  fatsecret_push_log: 'server-side push audit; never exposed',
  audit_log: 'security audit trail; never exposed',
  auth_session: 'session/credential material; never exposed',
  plan_revision: 'opaque revision blobs; not part of the API',
}
const HELP = `Usage: node scripts/check-domain-api-surface.mjs [--manifest <path>] [--schema-helper <path>] [--help]

Validates persisted domain fields against the declared public API surface (INV-125).

Options:
  --manifest <path>       Manifest path (default: domain-api-surface.json at repository root)
  --schema-helper <path>  Live schema helper (auto-detected at scripts/lib/domain-api-schema.ts)
  --help, -h              Show this help and exit

Exit codes: 0 pass, 1 policy failure, 2 operational or manifest-schema error.`

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`)
    process.exit(0)
  }

  function operational(message) {
    process.stderr.write(`[ERROR] ${message}\n`)
    process.exit(2)
  }

  function option(name, fallback) {
    const index = args.indexOf(name)
    if (index === -1) return fallback
    if (!args[index + 1] || args[index + 1].startsWith('--'))
      operational(`Missing value for ${name}.`)
    return resolve(args[index + 1])
  }

  function fail(messages) {
    for (const message of messages) process.stderr.write(`[FAIL] ${message}\n`)
    process.stderr.write('[FAIL] Review the fixed exemption allowlist and DOMAIN-API-GAPS.md.\n')
    process.exit(1)
  }

  const repoRoot = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : resolve('.')
  const manifestPath = option('--manifest', join(repoRoot, 'domain-api-surface.json'))
  const defaultHelperPath = join(ROOT, 'scripts/lib/domain-api-schema.ts')
  const helperPath = args.includes('--schema-helper')
    ? option('--schema-helper', defaultHelperPath)
    : existsSync(defaultHelperPath)
      ? defaultHelperPath
      : null
  if (!existsSync(manifestPath)) fail([`Manifest not found: ${manifestPath}`])

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    operational(`Manifest is unreadable or invalid JSON: ${manifestPath}`)
  }
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    manifest.schema !== SCHEMA
  ) {
    operational(`Manifest must be an object with schema ${SCHEMA}.`)
  }

  if (!Array.isArray(manifest.resources)) {
    operational('Manifest resources must be an array.')
  }
  if (!helperPath) {
    const gaps = []
    for (const resource of manifest.resources) {
      const resourceName = resource.resource ?? '(unnamed)'
      if (!Array.isArray(resource.domainFields)) continue
      for (const field of resource.domainFields) {
        if (field.persisted === true && !field.inRequestSchema && !field.inResponseSchema) {
          gaps.push({ resource: resourceName, field: field.name ?? '(unnamed)' })
        }
      }
    }
    if (gaps.length > 0) {
      console.error(
        `[domain-api-surface] FAIL — ${gaps.length} persisted field(s) unreachable through HTTP API:`,
      )
      for (const gap of gaps) {
        console.error(
          `  ${gap.resource}.${gap.field}: persisted=true but absent from request AND response schemas`,
        )
      }
      console.error(
        'Fix: set inRequestSchema:true or inResponseSchema:true, or set persisted:false if intentionally hidden.',
      )
      process.exit(1)
    }
    const checked = manifest.resources.reduce((sum, resource) => {
      return sum + (resource.domainFields?.length ?? 0)
    }, 0)
    console.log(
      `[domain-api-surface] PASS — ${checked} field(s) across ${manifest.resources.length} resource(s) all reachable`,
    )
    process.exit(0)
  }

  let schema
  const helper = spawnSync(process.execPath, ['--import', 'tsx', helperPath], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (helper.error || helper.status !== 0) {
    operational(
      `Schema helper failed: ${helper.error?.message ?? (helper.stderr.trim() || helper.status)}`,
    )
  }
  try {
    schema = JSON.parse(helper.stdout)
    if (
      !schema ||
      typeof schema !== 'object' ||
      Array.isArray(schema) ||
      Object.values(schema).some(
        (fields) => !Array.isArray(fields) || fields.some((field) => typeof field !== 'string'),
      )
    ) {
      throw new Error()
    }
  } catch {
    operational('Schema helper did not print the expected JSON object.')
  }

  function mountedRoutes() {
    const index = readFileSync(join(ROOT, 'src/server/index.ts'), 'utf8')
    const modules = new Map()
    for (const match of index.matchAll(
      /import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/routes\/([^'"]+)['"]/g,
    )) {
      for (const name of match[1].split(',').map((item) => item.trim())) modules.set(name, match[2])
    }
    const mounts = new Map()
    for (const match of index.matchAll(
      /app\s*\.\s*use\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\(/g,
    )) {
      const module = modules.get(match[2])
      if (module) mounts.set(module, match[1])
    }
    const routes = new Set()
    for (const [module, mount] of mounts) {
      const source = readFileSync(join(ROOT, 'src/server/routes', `${module}.ts`), 'utf8')
      for (const match of source.matchAll(
        /router\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi,
      )) {
        routes.add(`${match[1].toUpperCase()} ${mount}${match[2]}`)
      }
    }
    return routes
  }

  const failures = []
  if (manifest.resources.length === 0) {
    operational('Manifest resources must be a non-empty array.')
  }
  const manifestTables = new Map()
  const routes = mountedRoutes()
  for (const resource of manifest.resources) {
    if (
      !resource ||
      typeof resource !== 'object' ||
      typeof resource.resource !== 'string' ||
      !resource.resource ||
      !Array.isArray(resource.domainFields) ||
      resource.domainFields.length === 0
    ) {
      failures.push('Each resource needs a non-empty resource name and domainFields array.')
      continue
    }
    if (manifestTables.has(resource.resource))
      failures.push(`Duplicate resource: ${resource.resource}`)
    manifestTables.set(resource.resource, resource)
    const fields = new Set()
    for (const field of resource.domainFields) {
      const label = `${resource.resource}.${field?.name ?? '<unknown>'}`
      if (!field || typeof field !== 'object' || typeof field.name !== 'string' || !field.name) {
        failures.push(`Invalid field: ${label}`)
        continue
      }
      if (fields.has(field.name)) failures.push(`Duplicate field: ${label}`)
      fields.add(field.name)
      if (
        typeof field.persisted !== 'boolean' ||
        typeof field.inRequestSchema !== 'boolean' ||
        typeof field.inResponseSchema !== 'boolean'
      ) {
        failures.push(`Flags must be booleans: ${label}`)
      }
      if (!Array.isArray(field.evidence)) {
        failures.push(`Evidence must be an array: ${label}`)
        continue
      }
      const directions = new Set()
      for (const evidence of field.evidence) {
        if (
          !evidence ||
          typeof evidence !== 'object' ||
          !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(evidence.method) ||
          typeof evidence.path !== 'string' ||
          !evidence.path ||
          !['request', 'response'].includes(evidence.in) ||
          typeof evidence.jsonPath !== 'string' ||
          !evidence.jsonPath
        ) {
          failures.push(`Invalid evidence: ${label}`)
          continue
        }
        directions.add(evidence.in)
        if (!routes.has(`${evidence.method} ${evidence.path}`)) {
          failures.push(`Unmounted evidence route: ${evidence.method} ${evidence.path} (${label})`)
        }
      }
      if (field.inRequestSchema === true && !directions.has('request')) {
        failures.push(`Request flag lacks request evidence: ${label}`)
      }
      if (field.inResponseSchema === true && !directions.has('response')) {
        failures.push(`Response flag lacks response evidence: ${label}`)
      }
      if (field.persisted === false) {
        const reason = ALLOWLIST[resource.resource]
        const allowed =
          reason &&
          (resource.resource !== 'plan_revision' ||
            ['previousPlan', 'newPlan'].includes(field.name))
        if (!allowed || field.note !== reason) failures.push(`Unauthorized exemption: ${label}`)
      }
      if (field.persisted === true && !field.inRequestSchema && !field.inResponseSchema) {
        failures.push(`Unreachable persisted field: ${label}`)
      }
    }
  }
  if (schema) {
    for (const [table, fields] of Object.entries(schema)) {
      const resource = manifestTables.get(table)
      if (!resource) {
        failures.push(`Missing table: ${table}`)
        continue
      }
      const declared = new Set(resource.domainFields.map((field) => field?.name))
      for (const field of fields)
        if (!declared.has(field)) failures.push(`Missing field: ${table}.${field}`)
      for (const field of declared)
        if (!fields.includes(field)) failures.push(`Stale field: ${table}.${field}`)
    }
    for (const table of manifestTables.keys())
      if (!(table in schema)) failures.push(`Stale table: ${table}`)
  }
  if (failures.length) fail(failures)
  process.stdout.write('domain-api surface (INV-125): OK\n')
}

try {
  main()
} catch (error) {
  process.stderr.write(`[ERROR] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}
