---
title: 'Agent Lifecycle Rule'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Agent Lifecycle Rule

When creating, modifying, or removing sub-agents:

1. Update the agent file in `.claude/agents/<name>.md`
2. Update `.claude/AGENT_REGISTRY.md` — add/remove the agent row and update interaction chains
3. Update this rules file if the agent affects always-loaded rules
4. Document the change in `docs/SYSTEM/DECISIONS.md` if the change is architectural
