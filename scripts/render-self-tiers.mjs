#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/render-self-tiers.mjs — regenerate arbiter's own 8-tier CI workflows from
// src/templates/github/workflows/*.ejs. Used during the #867 dogfood dual-run window.
//
// Usage:
//   npm run build                            # ensure dist/ is current
//   node scripts/render-self-tiers.mjs       # writes .github/workflows/0[1-9]-*.yml
//
// Idempotent: overwrites existing rendered files. The 18 legacy workflows
// (ci.yml, nightly.yml, mutation.yml, …) are NOT touched — they coexist during
// dual-run and get migrated/deleted in #867 phases C2/C3.
//
// Config below mirrors arbiter.json + package.json + arbiter's archetype/language
// classification. Update if arbiter ever changes its own self-classification.

import { renderTemplate } from '../dist/utils/render.js'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const config = {
  targetDir: '.',
  projectName: 'arbiter',
  description: 'Framework for serious AI-assisted software development',
  language: 'typescript',
  framework: null,
  archetype: 'library',
  architectureStyle: 'none',
  isMultiTenant: false,
  hasDatabase: false,
  hasPublicApi: false,
  buildTool: 'npm',
  buildCommand: 'npm run build',
  testCommand: 'npm test',
  lintCommand: 'npm run lint',
  formatCommand: 'npx prettier --check .',
  tools: ['claude', 'codex'],
  governanceLevel: 'L2',
  useGitHub: true,
  githubOwner: 'LucaDominici',
  githubRepo: 'arbiter',
  existing: {
    agentsMd: true,
    claudeDir: true,
    agentsDir: true,
    aiRulez: false,
    settingsJson: true,
    checkAllScript: true,
    geminiDir: false,
    windsurfRules: false,
    aiderConf: false,
  },
  languageHooks: [],
  enableDebtGates: true,
  enableSuppressions: true,
  enableSecurityScanning: true,
  enableSoloDevMode: true,
  invariantTiers: ['architectural', 'governance', 'data', 'operational'],
  basePackage: undefined,
  contractType: 'none',
  lanes: ['docs'],
}

const TIER_FILES = [
  '01-pr-fast.yml',
  '02-pr-extended.yml',
  '03-human-approval.yml',
  '05-release.yml',
  '06-nightly.yml',
  '07-weekly.yml',
  '08-monthly.yml',
  '09-heartbeat.yml',
]

// Replace hardcoded ubuntu-latest with arbiter's self-hosted-runner vars expression
// (INV-13, check-workflow-runners.mjs). The templates use ubuntu-latest because
// that is the correct default for generated downstream projects; arbiter's own
// self-dogfooded copies must route to the docker-ci-build runner.
const RUNNER_VAR = "${{ vars.CI_BUILD_RUNNER_LABEL || 'docker-ci-build' }}"
const RUNS_ON_UBUNTU = /^(\s*runs-on:\s*)ubuntu-latest\s*$/gm

for (const f of TIER_FILES) {
  const rendered = renderTemplate(`github/workflows/${f}.ejs`, config)
  const pinned = rendered.replace(RUNS_ON_UBUNTU, `$1${RUNNER_VAR}`)
  writeFileSync(join('.github/workflows', f), pinned)
  console.log(`wrote .github/workflows/${f} (${pinned.length} bytes)`)
}
