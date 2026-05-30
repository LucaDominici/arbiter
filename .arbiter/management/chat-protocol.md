# Chat protocol — quando aprire nuova chat, come bridarla

> Regole di engagement chat per evitare drift, brain split, e context bloat. Manager: Claude. Operatore: Luca.

---

## Iron law (ricorda sempre)

1. **Ogni chat di lavoro inizia con**: Claude legge `MILESTONES.md` + chiede a Luca "su quale stream/milestone lavoriamo?"
2. **Ogni chat di lavoro chiude con**: Claude propone aggiornamento di `MILESTONES.md` + `DONE.md` se qualcosa ha shippato. Luca conferma. Solo dopo si chiude.
3. **Se Luca dimentica di chiamare la review**: Claude la auto-attiva al primo messaggio.

---

## Tipi di chat

### Tipo M — Management (rara, ~1 ogni 2 settimane)

- **Scopo**: review milestone, riallinea priorità, sposta queue → active, decide chiusure stream
- **Quando**: settimanale informale (5 min in chat esistente) + mensile profondo (chat dedicata)
- **Brief iniziale**: "Review milestone management"
- **Output**: aggiornamento `MILESTONES.md` (priorità, queue, kill criteria)

### Tipo W — Work (la maggior parte)

- **Scopo**: avanzare UN milestone concreto (audit, design, ADR, fix, PR draft)
- **Quando**: ogni volta che si lavora su uno specifico item
- **Brief iniziale standard**:
  ```
  Stream: <A/B/C/D>
  Milestone: <es. "Active 1 — haben smoke test arbiter">
  Stato corrente: <da MILESTONES.md>
  Obiettivo di questa chat: <cosa vogliamo shippare alla fine>
  Definition of Done per questa chat: <criterio oggettivo>
  ```
- **Output**: artefatto concreto + entry in DONE.md + advancement di MILESTONES.md

### Tipo Q — Quick (raro)

- **Scopo**: domanda rapida, decisione tattica, no artefatti
- **Quando**: <5 min di scambio previsto
- **Brief iniziale**: la domanda
- **Output**: decisione presa, eventualmente nota in MILESTONES.md DECISIONS log

---

## Quando aprire NUOVA chat (lista di trigger)

Claude DEVE proporre apertura nuova chat quando:

1. **Topic shift**: si passa da management → work, o da uno stream all'altro
2. **Context bloat**: chat corrente >30 message scambi attivi, sintomi di lentezza
3. **Cognitive load shift**: si passa da tattico (debug, ADR) a strategico (positioning, pricing) o viceversa
4. **Tool/scope shift**: si passa da arbiter source code → discovery LinkedIn → haben test (3 mondi diversi)
5. **Risultato shippato**: una milestone ha shippato, è il momento naturale di chiudere e riaprire fresh
6. **Token pressure**: Claude rileva token usage alto

**Come Claude propone**: "Chiuderei questa chat ora. Apri una nuova chat con questo brief: [brief preconfezionato]."

---

## Briefing template per nuova chat di lavoro

Quando Claude suggerisce apertura nuova chat, prepara questo testo che Luca può copia-incollare nel nuovo chat opener:

```
[BRIEF]
Stream: <X>
Milestone: <Y>
Da MILESTONES.md sezione "Active": <stato attuale>

Contesto last chat: <2-3 righe>

Obiettivo: <cosa vogliamo shippare>

Definition of Done: <criterio oggettivo>

Prima azione: <cosa fa Claude per primo>
```

Luca apre nuova chat, paste, Claude esegue.

---

## Chat che restano aperte

- **Questa chat (management)**: resta aperta come "library di setup" e backup. Solo per management review trimestrali o emergenze. NON usare per work.
- **Le chat di work**: vivono fino alla milestone chiusa, poi si chiudono.

---

## Anti-pattern da evitare

- ❌ "Mentre siamo qui, fammi anche X" (X è di un altro stream) → STOP, apri nuova chat
- ❌ "Continuiamo qui domani su Y" se Y è diverso da quello che stiamo facendo → no, nuova chat per Y
- ❌ "Riassumi tutto e ripartiamo" (perdita di tempo) → no, MILESTONES.md è il riassunto
- ❌ "Aspetta che cambio idea su Z" mid-chat senza traccia → ferma, decisione va in DECISIONS log
- ❌ Chiudere chat senza aggiornare DONE.md / MILESTONES.md → iron law violation

---

## Come Claude segnala drift in chat

Tre livelli:

1. **Soft nudge**: "Attenzione, stiamo deviando da Y. Restare focus o nuova chat per Z?"
2. **Hard stop**: "Stop. Questo è argomento per chat dedicata. Brief: [...]. Apri nuova chat?"
3. **Iron law violation**: "Stiamo per chiudere senza aggiornare MILESTONES.md. Aggiorno ora."

---

## Come Luca segnala a Claude di aprire nuova chat

Tre modi accettati:
- "Apri nuova chat per X" → Claude prepara brief + saluta
- "Chiudi e riapri su Y" → idem
- "Mi sto disperdendo" → Claude propone split + brief

---

## Failure mode previsto + recovery

**Failure**: Luca dimentica di aggiornare MILESTONES.md per 2+ chat consecutive.
**Recovery**: prossima chat Claude rileva (legge timestamp), propone retro-update.

**Failure**: chat di work supera 50 messaggi senza ship.
**Recovery**: Claude force-stop, propone split in milestone più piccole.

**Failure**: stream va in stallo >2 settimane senza progress.
**Recovery**: review settimanale lo cattura, applica kill criterion definita in MILESTONES.md.

---

_Ultima review: 2026-05-26 (setup). Da rivedere a ogni shift di operating model._
