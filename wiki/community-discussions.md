---
generated: true
source: 'docs/COMMUNITY/DISCUSSIONS.md'
source_sha: '3cf8e33a437fdc5cc83eee972192498e0ff7848a'
last_updated: '2026-06-06'
---

# arbiter GitHub Discussions

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/COMMUNITY/DISCUSSIONS.md](../docs/COMMUNITY/DISCUSSIONS.md)

# arbiter GitHub Discussions

**Link:** https://github.com/LucaDominici/arbiter/discussions

GitHub Discussions is the primary forum for arbiter questions, ideas, and community show-and-tell. Use Issues for confirmed bugs and implementation tasks; use Discussions for everything else.

## Categories

| Category          | Format | Purpose                                                                           |
| ----------------- | ------ | --------------------------------------------------------------------------------- |
| **Announcements** | Locked | Releases, security notices, major project news. Maintainer-only posting.          |
| **Ideas**         | Open   | Feature proposals. Check for duplicates + upvote instead of posting a new thread. |
| **Q&A**           | Q&A    | Questions with an accepted answer. Mark the solution so future visitors find it.  |
| **Show & Tell**   | Open   | Projects, plugins, custom invariants, governance stacks built with arbiter.       |
| **Help**          | Open   | Setup walkthroughs, brownfield migration, longer troubleshooting threads.         |
| **Polls**         | Poll   | Prioritisation votes — which language stacks, archetypes, or integrations next.   |

## Setup (maintainers)

Discussions are enabled via a one-shot script that also seeds first posts per category:

```bash
# Preview what will happen
node scripts/setup-discussions.mjs

# Apply (requires repo-admin gh auth)
node scripts/setup-discussions.mjs --confirm
```

The script is idempotent: re-running skips already-existing categories and posts.
