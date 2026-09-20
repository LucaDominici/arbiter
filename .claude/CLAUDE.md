---
title: 'arbiter — Claude Code Configuration'
doc_version: '1.0.0'
status: active
last_review: '2026-09-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

@AGENTS.md

# arbiter — Claude Code

Claude Code-specific hooks and permissions are configured in `.claude/settings.json`.
Claude-specific agents and commands live under `.claude/agents/` and `.claude/commands/`.
Use `/ship #NNN` as the delivery entrypoint.
Collaboration mode: `trunk-solo` — merge: `pr-ff` / branch: `trunk-direct`; land changes through a PR branch.
