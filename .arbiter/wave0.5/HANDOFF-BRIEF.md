# Wave 0.5 — Handoff brief for first implementation chat

> Copy the **[BRIEF] block below** as opening message of the next work chat.
> Everything outside the block is for reference only.

---

## [BRIEF]

```
Stream: A — Arbiter Product
Milestone: Wave 0.5 — template self-consistency fix (Active 2, promosso da Wave 0)
Da MILESTONES.md §Active 2: 6 P0 ordinati in sequenza (F4+F11 → F9 → F2 → F10 → F1+F7).
Vedi anche .arbiter/wave0.5/PLAN.md per il piano aggregato.

Contesto last chat (Wave 0 smoke test, 2026-05-26):
- Smoke test su haben con arbiter HEAD ha trovato 12 finding (6 P0)
- F11 scoperto durante cleanup F4: 152 project board orfani su account LucaDominici
- Report completo: .arbiter/wave0/haben-smoke-test.md
- Evidence preservata: .arbiter/wave0/evidence/ (6 log + gh-projects-snapshot.json + cleanup script)
- DEC-005 in vigore: Claude draft ADR/plan, Luca code

Pre-requisiti operativi da fare PRIMA di iniziare ADR-001:
1. Cleanup 152 board orfani: bash .arbiter/wave0/evidence/cleanup-orphan-boards.sh --dry-run, review, poi --execute
2. Fix arbiter clone remote misconfig (F12): cd ~/work/repos/arbiter && git remote set-url origin https://github.com/LucaDominici/arbiter.git && git fetch origin
3. Commit di Wave 0 + Wave 0.5 evidence su task branch (suggerimento: task/wave0-evidence) prima di iniziare PR di codice
4. Verifica gh project list post-cleanup: deve restare solo #1 "Viafera Backlog"

Obiettivo della chat: shippare ADR-001 (F4 + F11) end-to-end. È il primo perché tappa l'emorragia remota — finché update può fare side effect gh, ogni nostro Wave 0.5 lavoro rischia di accumulare altri board.

Definition of Done della chat:
- Issue arbiter aperta su GH (Claude prepara body completo dall'ADR-001, Luca submit)
- Task branch task/wave0.5-001-no-github-flag (da arbiter:main pulito, post F12 fix)
- .agents/plan/PLAN.json con Existing Code Survey completo (CANON-16) — Claude draft
- Implementazione + test (Luca code, DEC-005)
- L1 + L2 verdi
- PR aperta + Claude review

Prima azione: rileggi MILESTONES.md aggiornato (iron law) + leggi .arbiter/wave0.5/ADR-001-no-github-flag.md, poi grep targets indicati nell'ADR (src/github/project-board.ts, src/commands/init.ts, src/commands/update.ts) per completare Existing Code Survey. Conferma con me se la light-survey nell'ADR copre tutto o se ti aspetti sorprese.
```

---

## File index per la chat

Tutto in `~/work/repos/arbiter/`:

### Wave 0 (read-only reference)
- `.arbiter/wave0/haben-smoke-test.md` — il report completo, 12 finding con repro
- `.arbiter/wave0/evidence/cleanup-orphan-boards.sh` — script bonifica 152 board (operatore esegue)
- `.arbiter/wave0/evidence/gh-projects-snapshot.json` — snapshot account GH a fine Wave 0
- `.arbiter/wave0/evidence/haben-*.txt` — log raw dello smoke test (6 file)

### Wave 0.5 (per implementare)
- `.arbiter/wave0.5/PLAN.md` — piano aggregato + sequenza + cross-cutting concerns
- `.arbiter/wave0.5/ADR-001-no-github-flag.md` — **PRIMO** (F4 + F11), 4-6h
- `.arbiter/wave0.5/ADR-002-exit-code.md` — secondo (F9), 2-4h
- `.arbiter/wave0.5/ADR-003-md-template-fix.md` — terzo (F2 + F3), 1-2h
- `.arbiter/wave0.5/ADR-004-templates-L1-pass.md` — quarto (F10 + INV-32), 1-3 gg
- `.arbiter/wave0.5/ADR-005-diff-scope.md` — quinto (F1 + F7), 1-2 gg

### Management
- `.arbiter/management/MILESTONES.md` — §Active 2 ha il dettaglio ordering
- `.arbiter/management/DONE.md` — Wave 0 entry già scritta
- `.arbiter/management/chat-protocol.md` — regole chat

## Anti-pattern da evitare nella prossima chat

- ❌ Aprire più di un ADR per chat — vedi chat-protocol §"Quando aprire NUOVA chat"
- ❌ Saltare il git remote fix (F12) — qualsiasi push fallirebbe
- ❌ Saltare il cleanup boards prima di iniziare — accumuleresti il 153° board ogni `arbiter update` test
- ❌ Iniziare con ADR-002/003 ignorando ADR-001 — il sequencing è motivato, non arbitrario
- ❌ Code-first prima del PLAN.json (CANON-16 violation)
- ❌ Saltare la review L1/L2 prima del commit

## Quando chiudere la chat ADR-001

Iron law: la chat chiude SOLO con:
1. PR aperta su `LucaDominici/arbiter`
2. Claude review pubblicata come commento PR
3. `MILESTONES.md` §Active 2 aggiornato — ADR-001 marcato done, ADR-002 next
4. `DONE.md` entry per ADR-001 con link PR

Se i 4 punti non si chiudono nello stesso run, va in `Blocked` con motivo esplicito.
