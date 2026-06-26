#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Visual verification script (#700): 5 DOM checks × 3 viewports via Playwright.
// Graceful fallback when Playwright is absent (--skip-if-missing).
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = resolve(process.cwd())
const VIEWPORTS = [375, 768, 1280]

// --- CLI arg parsing ---
const args = process.argv.slice(2)
let url = null
let taskId = 'unknown'
let evidenceDir = join(REPO_ROOT, '.arbiter', 'evidence', 'visual')
let skipIfMissing = false
let showHelp = false
const forcePWSkip = process.env.PLAYWRIGHT_SKIP === '1'

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) url = args[++i]
  else if (args[i] === '--task-id' && args[i + 1]) taskId = args[++i]
  else if (args[i] === '--evidence-dir' && args[i + 1]) evidenceDir = resolve(args[++i])
  else if (args[i] === '--skip-if-missing') skipIfMissing = true
  else if (args[i] === '--help') showHelp = true
}

if (showHelp) {
  process.stdout.write(
    'Usage: visual-verify.mjs [--url <url>] [--task-id <id>] [--evidence-dir <dir>] [--skip-if-missing]\n' +
      '\n' +
      'Runs 5 Playwright visual checks × 3 viewports (375/768/1280).\n' +
      'Requires @playwright/test + chromium (npm install -D @playwright/test && npx playwright install chromium).\n' +
      'With --skip-if-missing: exits 0 and writes skip marker when Playwright is absent.\n',
  )
  process.exit(0)
}

// --- Check Playwright availability ---
function playwrightAvailable() {
  if (forcePWSkip) return false
  const r = spawnSync(process.execPath, ['-e', 'require("@playwright/test")'], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
  })
  return r.status === 0
}

const pwAvailable = playwrightAvailable()

if (!pwAvailable) {
  const msg =
    'Playwright not installed. Run:\n' +
    '  npm install -D @playwright/test\n' +
    '  npx playwright install chromium\n'

  if (skipIfMissing) {
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, 'visual-verify-skipped.json'),
      JSON.stringify(
        {
          skipped: true,
          reason: 'Playwright not installed',
          install: 'npm install -D @playwright/test && npx playwright install chromium',
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    )
    process.stdout.write('[visual-verify] Playwright absent — skip marker written.\n')
    process.exit(0)
  }

  process.stderr.write(`[visual-verify] ERROR: ${msg}`)
  process.exit(1)
}

if (!url) {
  process.stderr.write(
    '[visual-verify] ERROR: --url is required.\nUsage: visual-verify.mjs --url <url> [--task-id <id>]\n',
  )
  process.exit(1)
}

// --- Run Playwright checks ---
// Inline Playwright script executed via node with dynamic import
const taskEvidenceDir = join(evidenceDir, taskId)
mkdirSync(taskEvidenceDir, { recursive: true })

const playwrightScript = `
import { chromium } from '@playwright/test'

const VIEWPORTS = ${JSON.stringify(VIEWPORTS)}
const TARGET_URL = ${JSON.stringify(url)}
const EVIDENCE_DIR = ${JSON.stringify(taskEvidenceDir)}
const { writeFileSync } = await import('node:fs')

const browser = await chromium.launch()
const allResults = []

for (const width of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width, height: 800 } })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })

  const title = await page.title()
  const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth)
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  const hasCTA = await page.locator('button:visible, a:visible').count().then(n => n > 0)
  const screenshotPath = \`\${EVIDENCE_DIR}/\${width}.png\`
  await page.screenshot({ path: screenshotPath, fullPage: true })

  allResults.push({
    width,
    checks: {
      'page-title':          { pass: !!title },
      'no-layout-overflow':  { pass: bodyScrollWidth <= viewportWidth },
      'primary-cta-visible': { pass: hasCTA, ...(hasCTA ? {} : { detail: 'no visible CTA found' }) },
      'no-console-error':    { pass: consoleErrors.length === 0, ...(consoleErrors.length ? { detail: consoleErrors } : {}) },
      'screenshot':          { pass: true, path: screenshotPath },
    },
  })

  await context.close()
}

await browser.close()

const total = VIEWPORTS.length * 5
const passed = allResults.reduce((s, v) => s + Object.values(v.checks).filter(c => c.pass).length, 0)
const report = {
  url: TARGET_URL,
  task_id: ${JSON.stringify(taskId)},
  timestamp: new Date().toISOString(),
  viewports: allResults,
  summary: { total, passed, failed: total - passed },
}

writeFileSync(\`\${EVIDENCE_DIR}/report.json\`, JSON.stringify(report, null, 2))
process.stdout.write(JSON.stringify(report.summary) + '\\n')
if (report.summary.failed > 0) process.exit(1)
`

const r = spawnSync(process.execPath, ['--input-type=module'], {
  input: playwrightScript,
  encoding: 'utf-8',
  cwd: REPO_ROOT,
  stdio: ['pipe', 'pipe', 'pipe'],
})

process.stdout.write(r.stdout ?? '')
process.stderr.write(r.stderr ?? '')
process.exit(r.status ?? 1)
