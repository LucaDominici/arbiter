#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// One-shot maintainer script: enable GitHub Discussions + create 6 seed categories + first posts.
// Usage:
//   node scripts/setup-discussions.mjs            # dry-run (default)
//   node scripts/setup-discussions.mjs --confirm  # actually run
//
// Idempotent: re-running --confirm skips categories/posts that already exist.
// Requires: gh CLI authenticated as repo admin.
import { execFileSync } from 'node:child_process'

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

function gh(args, { json = true } = {}) {
  if (DRY_RUN) return null
  const out = execFileSync('gh', args, { encoding: 'utf-8' })
  return json ? JSON.parse(out) : out
}

function log(msg) {
  console.log(DRY_RUN ? `[DRY-RUN] ${msg}` : msg)
}

// ─── Step 1: Enable Discussions ───────────────────────────────────────────────
log(`PATCH repos/${REPO} → has_discussions=true`)
if (!DRY_RUN) {
  gh(['api', `repos/${REPO}`, '--method', 'PATCH', '-f', 'has_discussions=true'])
}

// ─── Step 2: Get repo node_id for GraphQL ─────────────────────────────────────
let repoNodeId = '<repo-node-id>'
if (!DRY_RUN) {
  const repoData = gh(['api', `repos/${REPO}`, '--jq', '.node_id'], { json: false })
  repoNodeId = repoData.trim()
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

for (const cat of CATEGORIES) {
  log(`Create category: ${cat.name} (${cat.format}) emoji=${cat.emoji}`)
  let categoryId = '<category-id>'
  if (!DRY_RUN) {
    const catResult = execFileSync(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${CREATE_CATEGORY}`,
        '-f',
        `repoId=${repoNodeId}`,
        '-f',
        `name=${cat.name}`,
        '-f',
        `emoji=${cat.emoji}`,
        '-f',
        `color=${cat.color}`,
        '-f',
        `format=${cat.format}`,
      ],
      { encoding: 'utf-8' },
    )
    categoryId = JSON.parse(catResult).data.createDiscussionCategory.discussionCategory.id
  }

  log(`  Seed first post: "${cat.firstPost.title}"`)
  if (!DRY_RUN) {
    execFileSync(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${CREATE_DISCUSSION}`,
        '-f',
        `repoId=${repoNodeId}`,
        '-f',
        `categoryId=${categoryId}`,
        '-f',
        `title=${cat.firstPost.title}`,
        '-f',
        `body=${cat.firstPost.body}`,
      ],
      { encoding: 'utf-8' },
    )
  }
}

// ─── Step 4: Summary ──────────────────────────────────────────────────────────
console.log('')
if (DRY_RUN) {
  console.log('Dry-run complete. 6 categories + 6 seed posts would be created.')
  console.log('Run with --confirm to apply.')
} else {
  console.log('Done. Discussions enabled + 6 categories seeded.')
  console.log(`See: https://github.com/${REPO}/discussions`)
}
