# Done log — append-only

> Ogni entry: data + cosa shippato + link evidence + chi/quando.

---

## 2026-05-28 — Wave 0.5 ADR-004 (F10): generated templates pass L1

- **Cosa**: chiuso F10 (smoking gun di Wave 0). Templates `arbiter init/update` ora producono output che passa `node scripts/check-all.mjs L1` senza alcuna correzione manuale. INV-32 fixture binding inclusa.
- **Issue**: [#1076](https://github.com/LucaDominici/arbiter/issues/1076) chiusa COMPLETED 2026-05-28 15:32 UTC
- **PR**: closedByPullRequestsReferences vuoto su issue — chiusura probabilmente raccolta da uno dei PR multi-issue del 28/05 ([#1080](https://github.com/LucaDominici/arbiter/pull/1080) collab axis + drift fix, oppure [#1083](https://github.com/LucaDominici/arbiter/pull/1083) CI gap closures). Da verificare a posteriori con `git log --all --grep="1076\|F10"`.
- **Impatto**: il primo dei 4 fail L1 di Wave 0 (`format`, `INV-75 action pins`, `INV-76 workflow perms`, `workflow runners`) è ora risolto strutturalmente. Demo arbiter è di nuovo credibile.
- **Owner**: Claude Code (impl in autonomia, fuori dalla view manager) · Luca (PR review/merge)

## 2026-05-27 — Wave 0.5 ADR-003 (F2 + F3): MD template fixes

- **Cosa**: chiuso F2 (pipe di chiusura tabella mancante in `.claude/CLAUDE.md`) + F3 (blank-line bloat in `GLOBAL_INVARIANTS.md`, padding regression, idempotence jitter). Template MD ora idempotenti + markdownlint-clean.
- **Issue**: [#1075](https://github.com/LucaDominici/arbiter/issues/1075)
- **PR**: [#1079](https://github.com/LucaDominici/arbiter/pull/1079) "fix(#1075): pipe closure + blank-line bloat in MD templates (F2+F3)" — mergiata 2026-05-27 20:56 UTC
- **Owner**: Claude Code · Luca (PR review/merge)

## 2026-05-27 — Wave 0.5 ADR-002 (F9): tiered POSIX exit codes for gh failures

- **Cosa**: chiuso F9 (exit 0 nonostante 25 errori `gh`). Exit code contract: 0 success, 1 recoverable aggregated, 2 fatal, 78 config error. Error taxonomy `RecoverableError`/`FatalError`/`ConfigError` library-wide.
- **Issue**: [#1074](https://github.com/LucaDominici/arbiter/issues/1074)
- **PR**: [#1078](https://github.com/LucaDominici/arbiter/pull/1078) "feat(#1074): tiered POSIX exit codes for gh failures (ADR-002, F9)" — mergiata 2026-05-27 15:04 UTC
- **Owner**: Claude Code · Luca (PR review/merge)

## 2026-05-27 — Wave 0 evidence + Wave 0.5 scaffold pushed to main

- **Cosa**: il branch `task/wave0-evidence` (commit `a5d133e4` + `033ed299`) è finalmente atterrato su main, sbloccando management files versionati.
- **PR**: [#1073](https://github.com/LucaDominici/arbiter/pull/1073) "docs(wave0): Wave 0 evidence + Wave 0.5 ADR-001 + hook fix" — mergiata 2026-05-27 15:03 UTC
- **Owner**: Claude Code (probabilmente sbloccato L2 dopo merge di altri fix) · Luca (merge)

## 2026-05-26 — Wave 0.5 ADR-001 (F4 + F11): `--github` opt-in default + board namespacing

- **Cosa**: implementato il primo P0 di Wave 0.5. `arbiter init/update` ora fa **zero** chiamate `gh` di default; `--github` o `ARBITER_GITHUB=1` per opt-in. Project board namespacing con template `<projectName> Board · owner/repo · YYYY-MM-DD UTC` + idempotence probe date-agnostic.
- **Issue**: [#1063](https://github.com/LucaDominici/arbiter/issues/1063)
- **Decisioni registrate**: DEC-008 (alias + deprecation per `useGitHub` → `permitGitHub`), DEC-009 (global flag pre-stripped + env var), DEC-010 (gate solo `runGithubSetup` + import-graph lock).
- **Red-team Phase 3.5**: 5 critical findings (gate location, undefined symbol, mutation vs read carve-out, v1-to-v2 migration order, IMPACT_MAP typing) + 13 high findings tutti incorporati nel plan prima di Phase 4.
- **Implementazione highlights**:
  - `--github` flag globale (cli.ts pre-strip pattern) + `ARBITER_GITHUB=1` env var
  - `permitGitHub` canonico + `useGitHub` deprecated alias (warn 1× per load)
  - Migration doc: `docs/MIGRATION/no-github-default.md`
  - 23 fixture bake snapshots ribakati (fewer `.github/**` files in default output — correct post-F4)
  - Static import-graph assertion: `diff.ts` does NOT import from `src/github/` (DEC-010 lock)
  - Hook contracts table, fail-closed baseline, 9 doc frontmatters risolti come side-effect cleanup
- **Owner**: Claude (ADR + plan + red-team + PR review) · Luca (code via Claude Code, DEC-005)
- **Nota operativa**: commit wave0-evidence ancora locale (push rinviato fino a F10/L2 sblocco); ADR-001 vive su `task/wave0.5-001-no-github-flag`.

## 2026-05-26 — Wave 0: haben smoke test arbiter (12 finding, 6 P0)

- **Cosa**: smoke test end-to-end di arbiter HEAD su haben. DOD 3/4 met; il 4° (L1 verde) convertito a hard audit per autorizzazione esplicita di Luca ("haben lo puoi seviziare, l'obiettivo è arbiter audit-proof").
- **Artefatto**: `.arbiter/wave0/haben-smoke-test.md` — 10 finding numerati con repro (removed from tree in chore/batch-a; see git history)
- **Highlight P0**:
  - F1/F7: `arbiter diff` sotto-riporta 89% (4 annunciati / 37 toccati); inconsistent con `update`
  - F2: template MD `.claude/CLAUDE.md` perde la pipe di chiusura → tabella rotta
  - F4: `arbiter update` crea un GitHub project board reale (https://github.com/users/LucaDominici/projects/153) senza preavviso, partendo da un comando file-locale
  - F9: exit 0 nonostante 25 errori HTTP `gh` → CI wrapper non vede mai i failure
  - F10: 4/20 check L1 falliscono su file appena generati da arbiter (format, INV-75, INV-76, workflow runners)
- **Kill criterion**: triggered ("L1 verde in 2 settimane"). Non è drift haben — è gap template-layer. Wave 0.5 proposto davanti a Wave 2A.
- **Side effect da pulire**: project board 153 creato sull'account `LucaDominici` (verificare username + cleanup manuale)
- **Owner**: Claude (audit) · Luca (autorizzazione + ack)

## 2026-05-26 — Setup management infrastructure

- **Cosa**: Claude promosso a manager di processo. Iron law adottata: nessuno skippa, nessuno dimentica.
- **Artefatti**:
  - [`MILESTONES.md`](MILESTONES.md) — single source of truth per gold target + WIP + queue
  - [`DONE.md`](DONE.md) — questo file
  - [`chat-protocol.md`](chat-protocol.md) — regole nuove chat / brief / hand-off
- **Memoria persistente aggiornata** (`~/.local/share/claude-agent/sessions/zen-confident-franklin/mnt/.auto-memory/`) con nuovo ruolo Claude
- **Owner**: Luca (decisione) + Claude (esecuzione setup)

## 2026-05-26 — Wave 1-bis: Luca's /auto pipeline audit

- **Cosa**: audit di 17 skill custom recuperate dal DR snapshot Mac
- **Artefatto**: `.arbiter/wave1/auto-pipeline-audit.md` — 290 LOC (removed from tree in chore/batch-a; see git history)
- **Correzione**: §17.2 del report principale corretta (Luca ha SUA /auto skill, NON è quella ufficiale Anthropic)
- **Output**: 12 pattern P0 identificati + 6 nuove pillole career
- **Owner**: Claude

## 2026-05-26 — Wave 1: viafera AI-layer audit completo

- **Cosa**: audit file-per-file di 88 file viafera (.claude/* + FRAMEWORK/DOCS/)
- **Artefatti**: `.arbiter/wave1/` — INDEX + 5 file di famiglia (skills, agents, hooks, commands, rules-templates-prompts-framework) (removed from tree in chore/batch-a; see git history)
- **Volume**: 1.157 LOC di analisi
- **Output**: 18 candidati P0 + plugin Java bundle + 18 pillole career
- **Owner**: Claude

## 2026-05-25 — Main analysis report

- **Cosa**: deep analysis arbiter (architettura, posizionamento competitivo, gap, pillole carriera)
- **Artefatto**: [`.arbiter/analysis-2026-05-25.md`](../analysis-2026-05-25.md) — 634 LOC (con §17/18/19 aggiunte successivamente)
- **Output**: 16 pillole career iniziali + roadmap di follow-up
- **Owner**: Claude
