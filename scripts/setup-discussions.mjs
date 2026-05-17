#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// One-shot maintainer script: enable GitHub Discussions + create 6 seed categories + first posts.
// Usage:
//   node scripts/setup-discussions.mjs            # dry-run (default)
//   node scripts/setup-discussions.mjs --confirm  # actually run
//
// Re-running --confirm after a partial failure is safe: already-created categories
// produce a GraphQL error that is logged and skipped; the script continues.
// Requires: gh CLI authenticated as repo admin (write:discussion + admin scope).
import { execFileSync, spawnSync } from 'node:child_process'

const DRY_RUN = !process.argv.includes('--confirm')
const REPO = 'LucaDominici/arbiter'

const CATEGORIES = [
  {
    name: 'Announcements',
    emoji: ':mega:',
    color: 'F9826C',
    format: 'ANNOUNCEMENT',
    firstPost: {
      title: 'Welcome to arbiter Announcements',
      body: 'Follow this category for releases, security notices, and major project news. Only maintainers can post here.',
    },
  },
  {
    name: 'Ideas',
    emoji: ':bulb:',
    color: 'F1E05A',
    format: 'OPEN_ENDED',
    firstPost: {
      title: 'Share your feature ideas',
      body: "Got an idea for arbiter? Post it here. Check existing ideas before opening — upvote what you'd use.",
    },
  },
  {
    name: 'Q&A',
    emoji: ':question:',
    color: 'A2EEEF',
    format: 'QUESTION_ANSWER',
    firstPost: {
      title: 'How to ask a good question',
      body: 'Include: arbiter version (`npx @arbiter/cli --version`), language + archetype, what you ran, what you expected, what happened. Mark the answer that solved your problem so future visitors find it quickly.',
    },
  },
  {
    name: 'Show & Tell',
    emoji: ':sparkles:',
    color: '0075CA',
    format: 'OPEN_ENDED',
    firstPost: {
      title: 'What are you building with arbiter?',
      body: 'Share projects, plugins, custom invariants, or governance stacks built with arbiter. Screenshots and repos welcome.',
    },
  },
  {
    name: 'Help',
    emoji: ':sos:',
    color: 'E4E669',
    format: 'OPEN_ENDED',
    firstPost: {
      title: 'Getting help with arbiter',
      body: 'Use Q&A for specific questions. Use this category for setup walkthroughs, brownfield migration stories, or longer troubleshooting threads.',
    },
  },
  {
    name: 'Polls',
    emoji: ':bar_chart:',
    color: 'D4C5F9',
    format: 'POLL',
    firstPost: {
      title: 'Which language stack should we prioritise next?',
      body: 'Help us prioritise the cross-language matrix. Vote for the language you most want promoted to `proven` status.',
    },
  },
]

function log(msg) {
  console.log(DRY_RUN ? `[DRY-RUN] ${msg}` : msg)
}

function ghRun(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'pipe'] })
  } catch (err) {
    const detail = [err.stderr, err.stdout].filter(Boolean).join('\n')
    throw new Error(`gh ${args.slice(0, 3).join(' ')} failed:\n${detail || err.message}`)
  }
}

function graphql(query, fields) {
  const fieldArgs = Object.entries(fields).flatMap(([k, v]) => ['-f', `${k}=${v}`])
  const raw = ghRun(['api', 'graphql', '-f', `query=${query}`, ...fieldArgs])
  const parsed = JSON.parse(raw)
  if (parsed.errors?.length) {
    const msgs = parsed.errors.map((e) => e.message).join('; ')
    throw new Error(`GraphQL errors: ${msgs}`)
  }
  return parsed.data
}

// ─── Preflight (always runs, even in dry-run) ─────────────────────────────────
const ghCheck = spawnSync('gh', ['--version'], { encoding: 'utf-8' })
if (ghCheck.status !== 0) {
  console.error('gh CLI not found. Install from https://cli.github.com/')
  process.exit(1)
}
const authCheck = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8' })
if (authCheck.status !== 0) {
  console.error('gh is not authenticated. Run: gh auth login')
  process.exit(1)
}

// ─── Step 1: Enable Discussions ───────────────────────────────────────────────
log(`PATCH repos/${REPO} → has_discussions=true`)
if (!DRY_RUN) {
  const patchRaw = ghRun([
    'api',
    `repos/${REPO}`,
    '--method',
    'PATCH',
    '-f',
    'has_discussions=true',
  ])
  const patchResult = JSON.parse(patchRaw)
  if (!patchResult.has_discussions) {
    console.error(
      'PATCH succeeded but has_discussions is still false — Discussions may not be available for this repo plan.',
    )
    process.exit(1)
  }
}

// ─── Step 2: Get repo node_id for GraphQL ─────────────────────────────────────
let repoNodeId = '<repo-node-id>'
if (!DRY_RUN) {
  const raw = ghRun(['api', `repos/${REPO}`, '--jq', '.node_id'])
  repoNodeId = raw.trim()
  if (!repoNodeId || !repoNodeId.startsWith('R_')) {
    console.error(
      `Could not resolve node_id for repo ${REPO}. Got: "${repoNodeId}". Verify REPO constant and gh authentication.`,
    )
    process.exit(1)
  }
}
log(`Resolved repo node_id: ${repoNodeId}`)

// ─── Step 3: Create categories + seed posts ───────────────────────────────────
const CREATE_CATEGORY = `
  mutation($repoId: ID!, $name: String!, $emoji: String!, $color: String!, $format: DiscussionCategoryFormat!) {
    createDiscussionCategory(input: { repositoryId: $repoId, name: $name, emoji: $emoji, color: $color, clientMutationId: "arbiter-setup", format: $format }) {
      discussionCategory { id name }
    }
  }
`

const CREATE_DISCUSSION = `
  mutation($repoId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
    createDiscussion(input: { repositoryId: $repoId, categoryId: $categoryId, title: $title, body: $body, clientMutationId: "arbiter-seed" }) {
      discussion { url }
    }
  }
`

const results = []

for (const cat of CATEGORIES) {
  log(`Create category: ${cat.name} (${cat.format}) emoji=${cat.emoji}`)
  const status = { name: cat.name, category: '?', post: '?' }

  if (!DRY_RUN) {
    let categoryId
    try {
      const catData = graphql(CREATE_CATEGORY, {
        repoId: repoNodeId,
        name: cat.name,
        emoji: cat.emoji,
        color: cat.color,
        format: cat.format,
      })
      categoryId = catData.createDiscussionCategory.discussionCategory.id
      status.category = 'created'
    } catch (err) {
      const msg = err.message
      status.category = msg.includes('already') ? 'already-existed' : `FAILED: ${msg}`
      status.post = status.category === 'already-existed' ? 'skipped' : '?'
      console.error(`  [${cat.name}] category: ${status.category}`)
      results.push(status)
      continue
    }

    log(`  Seed first post: "${cat.firstPost.title}"`)
    try {
      graphql(CREATE_DISCUSSION, {
        repoId: repoNodeId,
        categoryId,
        title: cat.firstPost.title,
        body: cat.firstPost.body,
      })
      status.post = 'seeded'
    } catch (err) {
      status.post = `FAILED: ${err.message}`
      console.error(`  [${cat.name}] post: ${status.post}`)
    }
  } else {
    log(`  Seed first post: "${cat.firstPost.title}"`)
    status.category = 'dry-run'
    status.post = 'dry-run'
  }

  results.push(status)
}

// ─── Step 4: Summary ──────────────────────────────────────────────────────────
console.log('')
console.log('Category              | Create     | Post')
console.log('----------------------|------------|------')
for (const r of results) {
  console.log(`${r.name.padEnd(21)} | ${r.category.padEnd(10)} | ${r.post}`)
}

const failed = results.filter((r) => r.category.startsWith('FAILED') || r.post.startsWith('FAILED'))

console.log('')
if (DRY_RUN) {
  console.log('Dry-run complete. Run with --confirm to apply.')
} else if (failed.length > 0) {
  console.error(`${failed.length} item(s) failed. Re-run with --confirm to retry.`)
  process.exit(1)
} else {
  console.log('Done. Discussions enabled + 6 categories seeded.')
  console.log(`See: https://github.com/${REPO}/discussions`)
}
