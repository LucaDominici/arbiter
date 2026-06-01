import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'arbiter',
  description: 'AI development governance framework — install once, enforce forever.',
  lastUpdated: true,
  cleanUrls: true,
  // Suppress known pre-existing dead links that point outside the VitePress build root
  ignoreDeadLinks: [/docs\/PLUGIN-API/, /docs\/INTEGRATIONS/],

  sitemap: {
    hostname: 'https://arbiter.dev',
  },

  head: [
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'arbiter — AI governance that installs itself.' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'One command installs a complete, standards-aligned governance stack into any project — AGENTS.md, hooks, gate scripts, CI workflows, and more.',
      },
    ],
    ['meta', { property: 'og:url', content: 'https://arbiter.dev' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'arbiter — AI governance that installs itself.' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'One command installs a complete, standards-aligned governance stack into any project.',
      },
    ],
  ],

  themeConfig: {
    // Outcome-first, audience-split IA (ADR-075). Order is load-bearing.
    nav: [
      { text: 'Get Started', link: '/quickstart/' },
      { text: 'Architecture', link: '/concepts/' },
      { text: 'Features', link: '/features/' },
      { text: 'Use-Cases', link: '/use-cases/' },
      { text: 'Problems Solved', link: '/problems/' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Governance & Legal', link: '/governance/' },
      // Utility (not part of the 7 outcome sections)
      { text: 'Community', link: '/community/' },
      { text: 'Changelog', link: '/changelog/' },
      { text: 'GitHub', link: 'https://github.com/LucaDominici/arbiter' },
      {
        text: 'v0 (next)',
        items: [
          { text: 'v0 (next)', link: '/' },
          { text: 'v0.1 (latest)', link: '/v/latest/' },
        ],
      },
    ],

    sidebar: [
      { text: 'Home', link: '/' },

      // 1. Get Started
      { text: 'Get Started', link: '/quickstart/' },

      // 2. Architecture
      { text: 'Architecture', link: '/concepts/' },

      // 3. Features
      { text: 'Features', link: '/features/' },

      // 4. Use-Cases (+ the consolidated recipe set)
      {
        text: 'Use-Cases',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/use-cases/' },
          { text: 'Recipes', link: '/recipes/' },
          { text: 'Custom invariant', link: '/recipes/custom-invariant' },
          { text: 'Custom generator', link: '/recipes/custom-generator' },
          { text: 'Write a plugin', link: '/recipes/plugin' },
          { text: 'Brownfield onboarding', link: '/recipes/brownfield' },
        ],
      },

      // 5. Problems Solved & How
      {
        text: 'Problems Solved & How',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/problems/' },
          { text: 'Agents drift from conventions', link: '/problems/agents-drift' },
          { text: 'Standards not enforced', link: '/problems/enforced-not-advisory' },
          { text: 'Secrets / PII in commits', link: '/problems/secrets-pii' },
          { text: 'Vulnerable dependencies', link: '/problems/vulnerable-deps' },
          { text: 'Suppressions become permanent', link: '/problems/suppression-expiry' },
          { text: 'Direct pushes / self-approval', link: '/problems/branch-protection' },
          { text: 'Tests written after the fact', link: '/problems/tdd-evidence' },
          { text: 'Can I trust the tool itself?', link: '/problems/dogfooding-trust' },
        ],
      },

      // 6. Reference
      {
        text: 'Reference',
        collapsed: false,
        items: [
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Hooks', link: '/reference/hooks' },
          { text: 'Stack Support', link: '/reference/stacks' },
          { text: 'Templates', link: '/reference/templates' },
          { text: 'Experimental Policy', link: '/reference/experimental-policy' },
        ],
      },

      // 7. Governance & Legal (Comparisons folds in here)
      {
        text: 'Governance & Legal',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/governance/' },
          {
            text: 'AGENTS.md',
            link: 'https://github.com/LucaDominici/arbiter/blob/main/AGENTS.md',
          },
          {
            text: 'ADR Ledger',
            link: 'https://github.com/LucaDominici/arbiter/tree/main/docs/ADR',
          },
          {
            text: 'Decisions',
            link: 'https://github.com/LucaDominici/arbiter/blob/main/docs/SYSTEM/DECISIONS.md',
          },
          {
            text: 'Comparisons',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/comparisons/' },
              { text: 'vs spec-kit', link: '/comparisons/spec-kit' },
              { text: 'vs BMAD', link: '/comparisons/bmad' },
              { text: 'vs GSD2', link: '/comparisons/gsd2' },
              { text: 'vs claude-flow', link: '/comparisons/claude-flow' },
              { text: 'vs SuperClaude', link: '/comparisons/superclaude' },
            ],
          },
        ],
      },

      // Utility / secondary (outside the 7 outcome sections)
      {
        text: 'More',
        collapsed: true,
        items: [
          { text: 'Integrations', link: '/integrations/' },
          { text: 'Community', link: '/community/' },
          {
            text: 'Changelog',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/changelog/' },
              { text: 'Stable', link: '/changelog/stable' },
              { text: 'Beta', link: '/changelog/beta' },
              { text: 'Canary', link: '/changelog/canary' },
            ],
          },
          { text: 'Translations', link: '/i18n/CONTRIBUTING' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/LucaDominici/arbiter' }],

    footer: {
      message: 'Released under the Apache 2.0 License.',
      copyright: 'Copyright © 2026 arbiter contributors',
    },

    editLink: {
      pattern: 'https://github.com/LucaDominici/arbiter/edit/main/website/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },
  },
})
