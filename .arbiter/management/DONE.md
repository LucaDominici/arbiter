# Done log — append-only

> Ogni entry: data + cosa shippato + link evidence + chi/quando.

---

## 2026-05-26 — Wave 0: haben smoke test arbiter (10 finding, 5 P0)

- **Cosa**: smoke test end-to-end di arbiter HEAD su haben. DOD 3/4 met; il 4° (L1 verde) convertito a hard audit per autorizzazione esplicita di Luca ("haben lo puoi seviziare, l'obiettivo è arbiter audit-proof").
- **Artefatto**: [`.arbiter/wave0/haben-smoke-test.md`](../wave0/haben-smoke-test.md) — 10 finding numerati con repro
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
- **Memoria persistente aggiornata** (`~/.local/share/claude-cowork/sessions/zen-confident-franklin/mnt/.auto-memory/`) con nuovo ruolo Claude
- **Owner**: Luca (decisione) + Claude (esecuzione setup)

## 2026-05-26 — Wave 1-bis: Luca's /auto pipeline audit

- **Cosa**: audit di 17 skill custom recuperate dal DR snapshot Mac
- **Artefatto**: [`.arbiter/wave1/mainsim-auto-pipeline.md`](../wave1/mainsim-auto-pipeline.md) — 290 LOC
- **Correzione**: §17.2 del report principale corretta (Luca ha SUA /auto skill, NON è quella ufficiale Anthropic)
- **Output**: 12 pattern P0 identificati + 6 nuove pillole career
- **Owner**: Claude

## 2026-05-26 — Wave 1: viafera AI-layer audit completo

- **Cosa**: audit file-per-file di 88 file viafera (.claude/* + FRAMEWORK/DOCS/)
- **Artefatti**: [`.arbiter/wave1/`](../wave1/) — INDEX + 5 file di famiglia (skills, agents, hooks, commands, rules-templates-prompts-framework)
- **Volume**: 1.157 LOC di analisi
- **Output**: 18 candidati P0 + plugin Java bundle + 18 pillole career
- **Owner**: Claude

## 2026-05-25 — Main analysis report

- **Cosa**: deep analysis arbiter (architettura, posizionamento competitivo, gap, pillole carriera)
- **Artefatto**: [`.arbiter/analysis-2026-05-25.md`](../analysis-2026-05-25.md) — 634 LOC (con §17/18/19 aggiunte successivamente)
- **Output**: 16 pillole career iniziali + roadmap di follow-up
- **Owner**: Claude
