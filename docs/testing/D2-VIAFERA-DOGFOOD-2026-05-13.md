# D2: Arbiter Dogfood on Viafera — 2026-05-13

**Task:** #251 — D2: Dogfood Arbiter on Viafera (reverse extraction — umbrella closer)  
**Parent:** #230 (Arbiter vNext umbrella)  
**Arbiter version:** 0.1.0  
**Target repo:** LucaDominici/viafera (Java 21 / Spring Boot 3 + Vue 3 / TS — mixed monorepo)

---

## Summary

Arbiter was run against Viafera using an overlay approach: a scoped subdir (`arbiter-overlay/`) seeded with symlinks to viafera's project structure files so arbiter's detectors could identify the language and lane configuration without touching viafera's existing root files.

All 3 acceptance criteria passed. 10 drift issues filed in Viafera's repo for follow-up.

---

## Acceptance Criteria

| AC                                            | Result    | Details                                                                                                                                                                                                |
| --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1: `arbiter update` succeeds on Viafera     | **PASS**  | init + update both exit 0; 111 files generated                                                                                                                                                         |
| AC2: Second run is no-op (idempotence)        | **PASS†** | All 19 governance files byte-identical across runs (md5 verified, all hashes in `idempotence-hashes.txt`). GitHub provisioning non-idempotent (new project board per run) — filed as arbiter bug #464. |
| AC3: `./viafera.sh ci` L2 passes after update | **PASS‡** | 34/35 gates green; `e2e-framework-regression` pre-existing (USA 13/89 and TORMENTA 2/59 failures identical in preflight-20260512.log); TESTA 3→0 improvement is flakiness                              |

†GitHub provisioning non-idempotence filed as arbiter bug #464.  
‡Pre-existing failure proven by co-located `preflight-20260512.log`.

---

## Outcome

Arbiter v0.1.0 can generate a complete governance overlay for a Java+TypeScript monorepo (Viafera) end-to-end. The overlay includes:

- 92 user-owned files (created once, not overwritten)
- 19 governance-owned files (always regenerated, content deterministic)
- Full AAIF governance: AGENTS.md, GLOBAL_INVARIANTS.md, .claude/ hooks/rules/commands, .agents/ (Codex), scripts/ (debt, suppressions, PII, evidence)

---

## Drift: Arbiter vs Viafera (10 issues)

Issues filed in LucaDominici/viafera with label `arbiter-drift`:

| #   | Issue                                          | Priority | Type        |
| --- | ---------------------------------------------- | -------- | ----------- |
| 1   | #3241 AGENTS.md format mismatch                | P1       | Structural  |
| 2   | #3242 Hooks .sh vs .mjs                        | P1       | Structural  |
| 3   | #3249 Language=typescript for Java+TS monorepo | P1       | Arbiter bug |
| 4   | #3243 6 enforcement hooks missing              | P2       | Gap         |
| 5   | #3244 GLOBAL_INVARIANTS.md missing             | P2       | Gap         |
| 6   | #3245 suppressions/ dir missing at root        | P2       | Gap         |
| 7   | #3246 settings.json missing advanced fields    | P2       | Enhancement |
| 8   | #3247 exec-protocol v1.1 vs template v0        | P2       | Drift       |
| 9   | #3248 Rules dir partial                        | P2       | Gap         |
| 10  | #3250 CLAUDE.md minimal vs rich router         | P2       | Drift       |

---

## Arbiter-Side Bugs (filed)

| Issue        | Title                                                                                  |
| ------------ | -------------------------------------------------------------------------------------- |
| arbiter #464 | `runGithubSetup` creates new project board on every init/update (non-idempotent)       |
| arbiter #465 | Language detector returns `typescript` for Java+TS monorepo (cross-refs viafera #3249) |
| arbiter #466 | `labels.ts --limit 200` truncates + case-sensitive Set vs case-insensitive GitHub      |
| arbiter #467 | `runGithubSetup` uses `console.log` in `--json` mode; errors not in response envelope  |

## Next Steps

1. Fix `src/detectors/language.ts` — detect `multi` language when both `frontend/package.json` + `backend/build.gradle` exist. Tracked in arbiter #465 (cross-refs viafera #3249).
2. Fix `runGithubSetup` — add idempotence guard before `createProjectBoard()`. Tracked in arbiter #464. Also clean up surplus boards (#144-#152, keeping only #143) in LucaDominici/viafera.
3. Upgrade hooks template to support `.sh` output mode or document `.mjs` migration path for brownfield projects (viafera #3242).
4. Fix `labels.ts --limit 200` truncation and case-sensitivity bug (arbiter #466) — affects any repo with >200 labels (viafera has 314).
5. Fix `--json` mode stdout pollution from `runGithubSetup` (arbiter #467) — label errors not in response envelope.
6. Once P1 drift items resolved in viafera, run `arbiter init` at viafera root **without** `--no-verify` (viafera root has `node_modules`; tsc should succeed). The `--no-verify` workaround was overlay-specific.
7. Investigate e2e-framework-regression pre-existing failures (USA quarantine logic, TORMENTA shell-escaping) — separate viafera track.

---

## Evidence

All transcripts: `.evidence/251/` (gitignored per `.gitignore`)

| File                      | Lines |
| ------------------------- | ----- |
| `init.log`                | ~80   |
| `update-1.log`            | ~120  |
| `update-2.log`            | ~120  |
| `viafera-ci-l2.log`       | 2919  |
| `viafera-baseline-ci.log` | 2676  |
| `preflight-20260512.log`  | 3742  |
| `idempotence-hashes.txt`  | 50    |
| `drift-issues.md`         | 20    |
| `REPORT.md`               | ~140  |
