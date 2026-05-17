#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Collects evidence artifacts, scrubs PII via regex denylist, writes to output dir.
// Usage: node scripts/publish-evidence-snapshot.mjs --input <dir> --output <dir>
//
// Regex denylist covers:
//   - Emails
//   - GitHub tokens (ghp_, ghs_, ghr_, ghu_, github_pat_)
//   - AWS access key IDs (AKIA...)
//   - Private/RFC1918 IPv4 addresses
//   - Internal hostnames (.local, .internal, .corp)
//   - Bearer tokens
//   - JWT triplets (header.payload.signature)
//   - Generic long hex/base64 secrets (32+ chars, uppercase hex)
//
// After writing, performs a re-scan pass on the output. Exits non-zero if any
// pattern survives.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

// ─── Scrub patterns ──────────────────────────────────────────────────────────

const PATTERNS = [
  // JWT triplet (before Bearer so Bearer+JWT is caught cleanly)
  {
    re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: '[JWT]',
  },
  // Bearer token (captures the credential after "Bearer ")
  {
    re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    replacement: '[BEARER_TOKEN]',
  },
  // GitHub tokens: ghp_, ghs_, ghr_, ghu_, github_pat_
  {
    re: /gh[psruo]_[A-Za-z0-9]{20,}/g,
    replacement: '[GH_TOKEN]',
  },
  {
    re: /github_pat_[A-Za-z0-9_]{20,}/g,
    replacement: '[GH_TOKEN]',
  },
  // AWS access key IDs
  {
    re: /AKIA[0-9A-Z]{16}/g,
    replacement: '[AWS_KEY]',
  },
  // Generic long uppercase hex/base64 secrets (32+ chars)
  {
    re: /\b[A-Z0-9]{32,}\b/g,
    replacement: '[SECRET]',
  },
  // Private IPv4 (10.x, 172.16-31.x, 192.168.x, 127.x)
  {
    re: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
    replacement: '[IPV4]',
  },
  // Internal hostnames
  {
    re: /\b[a-z0-9]([a-z0-9-]*[a-z0-9])?\.(?:local|internal|corp)\b/gi,
    replacement: '[HOSTNAME]',
  },
  // Email addresses
  {
    re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL]',
  },
]

function scrub(content) {
  let out = content
  for (const { re, replacement } of PATTERNS) {
    re.lastIndex = 0
    out = out.replace(re, replacement)
  }
  return out
}

function hasSensitive(content) {
  for (const { re } of PATTERNS) {
    re.lastIndex = 0
    if (re.test(content)) return true
  }
  return false
}

// ─── File walking ────────────────────────────────────────────────────────────

function walkFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...walkFiles(full))
    } else {
      results.push(full)
    }
  }
  return results
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
let inputDir = null
let outputDir = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--input' && i + 1 < args.length) inputDir = args[++i]
  else if (args[i] === '--output' && i + 1 < args.length) outputDir = args[++i]
}

if (!inputDir || !outputDir) {
  process.stderr.write('Usage: publish-evidence-snapshot.mjs --input <dir> --output <dir>\n')
  process.exit(1)
}

const files = walkFiles(inputDir)
if (files.length === 0) {
  process.stderr.write(`publish-evidence-snapshot: no evidence files found in ${inputDir}\n`)
  process.exit(1)
}
let rescanFailed = false

for (const file of files) {
  const rel = relative(inputDir, file)
  const outPath = join(outputDir, rel)
  mkdirSync(dirname(outPath), { recursive: true })

  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`publish-evidence-snapshot: cannot read ${rel}: ${msg}\n`)
    rescanFailed = true
    continue
  }

  const scrubbed = scrub(content)
  writeFileSync(outPath, scrubbed)

  // Re-scan pass
  if (hasSensitive(scrubbed)) {
    process.stderr.write(`publish-evidence-snapshot: PII survived scrub in ${rel}\n`)
    rescanFailed = true
  }
}

if (rescanFailed) {
  process.stderr.write('publish-evidence-snapshot: FAILED — sensitive patterns survived re-scan\n')
  process.exit(1)
}

process.stdout.write(`publish-evidence-snapshot: OK — ${files.length} file(s) scrubbed\n`)
