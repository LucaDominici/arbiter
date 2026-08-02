# Wave 2 — Publish Hygiene

Branch: `task/wave2-publish-hygiene`

Issues: #2128, #2133, #2132, #2126

## Acceptance Criteria

- [ ] AC-2128.1: `engines.npm` nel package.json pubblicato ammette npm 11 (range corretto, es. `>=9`), mantenendo il vincolo node esistente.
- [ ] AC-2128.2: test che valida il tarball di `npm pack`: con `engine-strict=true` e npm 11 la install non è rifiutata per engines (verifica sul campo engines del tarball, senza rete).
- [ ] AC-2128.3: nessun altro campo engines regredisce.
- [ ] AC-2133.1: il package.json dentro il tarball `npm pack` non contiene script di sviluppo (in particolare nessun `prepare` con `core.hooksPath`); ammessi solo gli script utili al consumer (allowlist esplicita nel test).
- [ ] AC-2133.2: i campi consumer-critical restano intatti (bin, exports/main, engines, files).
- [ ] AC-2133.3: test che estrae il tarball e asserisce il set script == allowlist.
- [ ] AC-2132.1: `arbiter init` su un repo con linguaggio non riconosciuto NON dichiara "Done!": esce con messaggio onesto ed exit code non-zero (o zero con warning esplicito e NESSUN suggerimento di comando destinato a fallire — scegliere e documentare la semantica).
- [ ] AC-2132.2: test con fixture repo a linguaggio ignoto che asserisce il comportamento scelto.
- [ ] AC-2132.3: il percorso a linguaggio riconosciuto resta invariato (test di regressione).
- [ ] AC-2126.1: le fixture `examples/{go,python,ts}-library` sono rigenerate col meccanismo documentato del repo (lo stesso usato dalla cella CI che le tiene fresche).
- [ ] AC-2126.2: Generator DEEP passa su tutte e tre le celle (niente "drift detected").
- [ ] AC-2126.3: la rigenerazione non introduce modifiche fuori da `examples/**` (più eventuali pin documentati).

## Non-Goals

- #2128: nessun cambio al flusso di publish o ai range Node.
- #2133: nessuna ristrutturazione del build e nessuna rimozione degli script dal manifest di sviluppo.
- #2132: nessun nuovo linguaggio e nessun cambio alla detection oltre il caso `unknown`.
- #2126: nessuna modifica ai generatori; solo rigenerazione delle fixture.
- Nessun intervento su #2135, #2137, #2138, #2139, #2141 o #2134.

## Files / Contracts Touched

- #2128: `package.json`, `package-lock.json`, test sul pack artifact.
- #2133: `package.json`, helper publish-manifest, `scripts/check-tarball-contents.mjs`, test sul pack artifact.
- #2132: `src/commands/init.ts`, `src/i18n/en.json`, inventario i18n, README, test comando init e fixture CLI/d'integrazione che ora dichiarano esplicitamente TypeScript.
- #2126: `examples/go-library/**`, `examples/python-library/**`, `examples/ts-library/**`, `__tests__/scripts/regenerate-examples.test.ts`.

## TDD Units

1. #2128 — RED: tarball rejects npm 11 range; GREEN: remove the npm upper bound while retaining Node engines.
2. #2133 — RED: packed manifest exposes development scripts; GREEN: lifecycle strip/restore plus tarball-content enforcement.
3. #2132 — RED: unknown-language init still generates and prints success; GREEN: fail before generation with actionable `--language <lang>` error.
4. #2126 — RED: `npm run examples:check` reports drift; GREEN: run `npm run examples:regenerate`, then all three stack checks pass.

## Verification

- During implementation: only the directly affected Vitest file or example drift command.
- Final local gate, exactly once: `node scripts/check-all.mjs L2`.
- CI: `gh pr checks --watch --fail-fast`.
- Landing: non-force exact-SHA push of the gated head to `main`; rebase and reverify if `main` advances.

## Conflict Risks

- `package.json` and `package-lock.json` are release hot spots; rebase is expected.
- Example regeneration may be large but must remain under the three named example directories.
- Any dependency on owner-decision issues is documented on the affected issue and removed from this wave.
