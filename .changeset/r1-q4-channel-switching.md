---
'arbiter': minor
---

docs(#663): channel switching policy + rollback path (R1.Q4)

Extends `docs/CHANNELS.md` with per-direction risk table (latest ↔ beta ↔ canary) and the rollback recipe leveraging the R1.K9/L9 building blocks (`.arbiter-generated.json.bak.<ts>` + `arbiter doctor --repair-state` + git history of `arbiter.json`). Documents which downgrades the framework will refuse and why.
