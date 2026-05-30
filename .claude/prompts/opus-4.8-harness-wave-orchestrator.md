---
title: Prompt — Opus 4.8 Harness-Wave Orchestrator (Dynamic Workflows)
type: prompt
status: active
date: 2026-05-29
doc_version: '1.0.0'
last_review: '2026-05-29'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/prompt']
related: []
---

# Prompt — Opus 4.8 Harness-Wave Orchestrator (Dynamic Workflows)

> Modello target: **Claude Opus 4.8** (rilasciato 2026-05-28, feature: Dynamic Workflows).
> Progetto: **arbiter** (`/home/luca/work/repos/arbiter`).
> Pipeline subagent: **`/task #NNN`** (lifecycle ufficiale arbiter: branch → plan → implement → gate → PR).
> Modalità: **Dynamic Workflow** con parallel subagents.

---

## PROMPT

Sei l'**orchestratore** di un Dynamic Workflow su arbiter. Il tuo compito è creare e risolvere il **maggior numero possibile** di issue mirate a costruire l'**harness fondazionale** del progetto, lavorando a **wave parallele di 4 worktree**, ciascuna pilotata dalla skill `/auto` che batcha fino a 5 issue affini per worktree.

### IRON LAW (non negoziabile)

1. **Worktree-only.** Ogni wave apre **almeno 4 worktree** isolati via `/wt-open`. Zero edit sul tree principale. Zero edit su `main`. Una worktree = un branch `task/...`.
2. **`/task` per worktree, batch ≤5.** Ogni worktree esegue il comando `/task #NNN` in modalità batch su un **gruppo di max 5 issue** affini (stessa area, stesso file set, stesso layer di harness). Il subagent itera `/task` sequenzialmente sulle issue del batch, riusando lo stesso branch worktree. Sotto i 5 issue solo se: sono grandi, toccano file delicati, o saturerebbero il contesto.
3. **Wave = 4 worktree in parallelo.** Spawni 4 subagent concorrenti — uno per worktree. Loro lavorano in isolamento. Tu **non scrivi mai codice direttamente**: solo plani, deleghi, fai merge.
4. **Foundations first, no roof-before-walls.** Prima dell'apertura della prima wave costruisci la **piramide harness** (vedi §Strategia). Ogni issue creata deve cadere su un piano inferiore già stabile. Se ti accorgi che stai per piazzare un'issue su un piano vuoto sotto → STOP, scendi.
5. **Merge intelligente per wave.** Alla chiusura di ogni wave: leggi i 4 risultati, risolvi i conflitti, ordina i merge per minimizzare rework, esegui il gate `node scripts/check-all.mjs L2` sul merge consolidato **prima** di aprire la wave successiva.
6. **Gate is sacred.** Nessuna PR senza `gate-pass.json` valido. Nessun `--no-verify`. Se una worktree fallisce il gate dopo due tentativi del subagent → la escludi dal merge della wave, apri un'issue di follow-up, prosegui.

### Strategia: piramide harness (foundations → roof)

Prima di aprire la wave 1, **enumera per piano** gli harness mancanti. Non saltare piani.

```
P0  Plumbing & invariants    → catalog.ts, hook scaffolding, gate scripts
P1  Test harness              → fixture loader, snapshot infra, matrix runner
P2  Generator harness         → template lint, dry-run differ, EJS guard
P3  Lifecycle harness         → /task, /wt-*, branch enforcement
P4  Observability harness     → debug-state, post-mortem hooks, telemetry
P5  Integration harness       → real-project fixtures, cross-language matrix
P6  Roof                      → DX polish, slash commands, ergonomia
```

**Regola d'ordine:** non aprire issue di Pn finché Pn-1 non ha verde su gate L2. Se serve sboccare Pn-1 con un fix minimo, quello fix è la prossima issue, non Pn.

### Loop operativo per wave

Per ogni wave _w_ (target: 4 wave per sessione, 16 worktree totali, fino a 80 issue):

**1. Plan (orchestratore):**

- Leggi `MILESTONES.md` (iron law manager: re-read all'inizio).
- Identifica il piano attivo Pn.
- Genera 4 cluster di issue (ognuno ≤5 issue, stessa area). Ogni issue ha: titolo, file target, criterio accettazione, INV/CANON applicabili, stima.
- Crea le issue su GitHub (`gh issue create`) etichettandole `wave/w`, `plane/Pn`, `harness`.

**2. Fan-out (4 subagent paralleli):**
Spawni 4 subagent Dynamic-Workflow, uno per cluster. Brief identico modulo cluster:

> Sei un worker arbiter su worktree isolato. Apri il worktree con `/wt-open task/#<lead-issue>`. Itera `/task #NNN` su questo batch: [issue IDs] — una issue alla volta, stesso branch worktree, ordine dato. Vincoli: rispetta INV-04 (no any), INV-06 (no orphan TODO), INV-12 (no PII, no direct child_process), CANON-16 (refactor-first survey nel plan di ogni `/task`). Gate L1 dopo ogni issue chiusa, L2 prima della PR finale del batch. Se gate fallisce due volte su una issue → ferma il batch a quella issue, riporta blocker, non bypassare.

**3. Fan-in (orchestratore, sequenziale):**
Quando tutti e 4 i subagent riportano:

- Leggi i 4 `gate-pass.json`. Scarta worktree senza pass.
- Ordina i merge per **minimum-conflict-first** (worktree che tocca meno file condivisi → merge per prima).
- Merge sequenziale su `main` (oppure su branch integrazione `integration/wave-w` se la wave include refactor cross-file).
- Esegui `node scripts/check-all.mjs L2` sul consolidato.
- Se verde → push, chiudi le issue. Se rosso → revert dell'ultimo merge, apri issue di reconciliation, prosegui.
- Chiudi i worktree con `/wt-close` (harvest se ci sono artefatti utili).

**4. Reflect (orchestratore):**

- Aggiorna `MILESTONES.md` con: wave completate, piano attivo, issue residue per piano.
- Decidi: stesso piano (più issue mancanti) o salita al piano successivo (Pn → Pn+1)?
- Apri la wave successiva o chiudi la sessione con report.

### Vincoli di parallelismo (rule 50-batch-execution)

- I 4 subagent della wave girano in **read-write parallel solo perché ognuno scrive su una worktree distinta** (path non sovrapposti, branch distinti). Questo è il caso permesso.
- Tu (orchestratore) **non spawni mai due subagent che scrivono sullo stesso branch**.
- Il merge è **sempre sequenziale**, mai parallelo.

### Output atteso a fine sessione

1. Report wave-by-wave: issue create, issue chiuse, issue follow-up, gate pass/fail, piano risultante.
2. `MILESTONES.md` aggiornato (iron law manager).
3. Lista PR mergiate con link.
4. Lista issue di follow-up etichettate per la prossima sessione.
5. Stato della piramide harness: quali piani sono verdi, quale è il prossimo piano da attaccare.

### Stop conditions

- Se due wave consecutive falliscono il gate consolidato → STOP, escalation a Luca.
- Se scopri un INV/CANON violation strutturale → STOP, apri issue di rule-change, non bypassare.
- Se il piano attivo Pn richiede architectural decision → STOP, scrivi ADR in `docs/SYSTEM/DECISIONS.md`, attendi review.

### Avvio

Conferma di aver letto `AGENTS.md`, `MILESTONES.md`, `.claude/knowledge-map.json`. Stampa la piramide harness con lo stato attuale di ogni piano. Proponi la composizione della wave 1 (4 cluster × ≤5 issue, tutti su P0 o sul piano più basso non-verde). Attendi go di Luca prima di creare le issue.
