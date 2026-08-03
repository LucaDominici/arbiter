---
title: 'Backlog drain strategy — August 2026 — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-08-03'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/audit']
related: []
---

# Strategia di drain del backlog — 2026-08-03

71 issue aperte. Obiettivo: implementarle con metodo nel minor tempo.

## Principi

1. **Clusterizzare per file-set disgiunto**, non per etichetta. Un cluster = un worktree = un lead = un branch. File-set disgiunti ⇒ parallelismo sicuro (ADR-103); file-set sovrapposti ⇒ serializzazione obbligata.
2. **Un piano per cluster, non per issue.** Le issue dello stesso cluster condividono causa e superficie: un solo ciclo plan→review→TDD copre 3-6 issue. È qui che si guadagna tempo davvero (lo studio #2176 lo quantifica: il planning multi-agente non paga, il piano ricco sì).
3. **Lead Opus coordina, Codex implementa** (regola ferrea), Fable verifica e mergia serialmente.
4. **Epic fuori dal drain.** Le issue epic/ricerca (#2034-2044, #2038-2039, #2135, #1943, #1887) non sono drenabili: vanno decomposte separatamente o restano parcheggiate. Metterle in un drain le trasforma in mega-diff.
5. **Verifica prima della vittoria**: ogni cluster passa L1 nel worktree, io rieseguo il gate e verifico gli osservabili sul binario prima del merge; push unico per ondata con L2.

## Clusters (ordine = valore × rischio)

### ONDATA 1 — correttezza dell'enforcement e day-1 (4 lead paralleli)

**A · Gate correctness** — `scripts/check-*.mjs`, `scripts/lib/`
#2122 (il gate TDD legge solo lo scope del commit: `feat(pr-tooling): … (#2098)` lo BYPASSA — è un buco nell'enforcement), #2112 (bloat ratchet senza check post-merge: due branch sotto soglia mergiano sopra), #2118 (allowlist i18n indicizzata per riga: si rompe a ogni inserimento), #2212 (fail-open-census manca 3 siti della propria classe), #2190 (bake fuori da L1/pre-push).

**B · init / brownfield** — `src/commands/init/`, `src/detectors/`, `scripts/capture-debt-baseline.mjs`
#2137 (monorepo pnpm/Astro: init esce 1 DOPO aver scritto 233 file, rileva npm, archetype sbagliato, 8 rossi alla prima gate), #2134 (prima gate rossa su due repo OSS reali), #2202 (baseline debito pre-install ⇒ zero spurio), #2125 (init non modella la adopt policy).

**C · config / update / livelli** — `src/config/`, `src/commands/update*`, `upgrade-level`
#2195 (downgrade silenzioso su livello non valido — fail-open sul campo che definisce "verde"), #2201 (grace L2→L3 dichiarata e inesistente), #2141 (la classe governance ripete l'errore di #2109), #2107 (skipIfExists congela i fix del framework).

**D · hooks / settings** — `.claude/hooks/`, `src/generators/claude.ts`, merge settings
#2121 (mergeHookEntry cancella l'entry locale per basename: perde `$CLAUDE_PROJECT_DIR`), #2200 (hook unused-exports blocca ogni edit su albero vergine), #2011 (check-no-any segnala `any` dentro la prosa), #2022 (enforce-gate-before-pr non intercetta da sessione subagent), #2054 (deny list senza equivalente Bash per i path di evidenza).

### ONDATA 2 — superficie, release, docs (4 lead)

**E · CLI surface & contratti** — `src/cli.ts`, envelope JSON
#2211 (tre comandi documentati e inesistenti), #2213 (envelope in 5 forme + `--seed` inerte), #2207 (`ship <id>` sovrascrive il tier persistito), #2184 (origine dei tier non-widest).

**F · release & packaging (sicurezza)** — `.github/workflows/release*`, `scripts/publish-*`
#2138 (cosign/SLSA/SBOM firmano un artefatto DIVERSO da quello pubblicato su npm, e `workflow_dispatch` raggiunge npm publish da un branch qualunque — il più grave di tutto il backlog per impatto), #2139 (nessun test importa i 4 sottopercorsi pubblici del pacchetto), #2018 (scrubber PII senza chiamanti).

**G · docs / SSOT / wiki** — `docs/`, `scripts/gen-*`
#2053 (`docs/internal/` gitignorato in blocco: nuovi ADR non arrivano mai), #2020 (path SSOT stale dentro sorgenti parity-checked), #2111 (`gen-wiki --changed` guarda solo HEAD~1 e riporta pagine che non ha scritto), #2214 (generatori docs assenti nei target), #1999 (template orfano).

**H · worktree / ship / orchestrazione** — `src/worktree/`, `src/commands/task*`
#2208 (lock di open non copre `git worktree add`), #2102 (`ship --chain` per merge-train), #2103 (contratto di dispatch terminal-handoff), #2085 (riuso evidenza SHA-stamped in pre-push).

### ONDATA 3 — pulizia e decisioni (2 lead)

**I · cleanup meccanico** — #2010 (isMainModule, ~29 idiomi duplicati), #2009 (3 script senza chiamanti), #2013 (ratchet grandfathered), #2012 (check che SKIPpano sempre), #2007 (flip anti-proforma a --enforce), #2031 (falsi positivi anti-proforma).
**J · decisioni** — #2016, #2017, #2014, #2107(se non chiusa in C), #2189, #2053(se non chiusa in G): richiedono una decisione esplicita prima del codice; il lead produce la raccomandazione, io decido.

### FUORI DRAIN — da decomporre a parte

Epic: #2034/#2035/#2036 (project invariants), #2038/#2039 (metodologia/cockpit), #2135 (reliability bar), #2043/#2041/#2044 (policy surfaces), #1943 (anti-context-rot), #1887 (tracking), #2150, #2077.
Alert CI automatici da verificare e chiudere se stantii: #2170, #2157, #2100, #2216(in corso).

## Contratto per ogni lead

- Worktree isolato (`arbiter wt open <primary-issue>`), branch `task/#<primary>-<slug>`.
- UN piano che copre tutte le issue del cluster: causa comune, file-set dichiarato, AC congelati per issue.
- TDD per issue: red reale committato separatamente quando il ciclo lo consente (altrimenti refs nel body — il gate TDD ri-esegue il test al commit pinnato).
- Dual-track dove l'artefatto è anche emesso.
- `check-all L1` verde nel worktree. Nessun push, nessun merge, nessuna chiusura di issue.
- Report finale: per-issue AC, tail verbatim, rischi residui, note filate.

## Cadenza

Ondata 1 (4 lead) → verifica+merge serializzato → push unico L2 → chiusura issue → Ondata 2 → idem → Ondata 3.
Se un cluster si blocca, non blocca gli altri: si mergia ciò che è pronto e il cluster bloccato riparte con root-cause scritto.
