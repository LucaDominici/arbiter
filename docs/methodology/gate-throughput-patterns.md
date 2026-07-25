---
title: 'Gate-Throughput Patterns — Operating Standard'
doc_version: '1.0.0'
status: active
last_review: '2026-07-23'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/governance']
related:
  [
    'docs/methodology/agent-orchestration-and-context-hygiene.md',
    'docs/REFERENCE/local-wrapper-contract.md',
  ]
---

# Gate-Throughput Patterns — Operating Standard

**Scope:** how WE keep a heavy local quality gate from becoming the bottleneck on issue
throughput — on every repo governed by arbiter, not only arbiter itself. These patterns
were extracted from a real 2026-07-23 incident (a multi-hour stretch of near-zero issue
closure despite 6-7 agents actively writing code, root-caused via a Fable-tier design
investigation) and validated with real before/after data, not designed at a whiteboard.

**Status of this document:** normative. Each pattern below states the mechanism, not just
the intent — a pattern without an enforcer is prose, and prose decays (see
`agent-orchestration-and-context-hygiene.md` §0, the Beyoncé rule).

---

## 1. Merge-train batching for sequential issue chains

**Symptom:** N issues with a real, declared dependency order (blocked-on labels, an
epic's own `1/N → 2/N[blocked] → ...` numbering) each get their own worktree and their own
full gate cycle — paying the gate's cost N times for work that was never parallel.

**Mechanism:** implement the whole chain in ONE worktree/branch, TDD per issue with a
separate commit per issue for traceability, run the full gate exactly ONCE after the last
issue lands, then one push and one PR closing every issue in the chain. Nothing reaches
`main` without a full gate pass on the exact tree merged — only the attribution
granularity changes (one gate covers N issues, not N gates covering N issues).

**Do not** apply to genuinely independent issues — batching unrelated work trades
gate-cycle savings for merge-conflict risk and unclear failure attribution. Cluster only
what was already meant to be sequential.

**Validated:** a consuming project's `preparation` module epic (4 issues, explicitly
chained) landed as one PR — 1 gate cycle instead of 4. See that project's own
PROCESS_CORE.md (or equivalent execution-governance doc) for the project-specific
codification and its `scripts/gates/chain-batching.sh`-class detector; this document is
the portable pattern, not the project-specific enforcement point.

---

## 2. Unify the fixer and the checker for derived/generated state

**Symptom:** a gate check validates generated output (a wiki mirror's `source_sha`, a doc
index, a license file, a status dashboard) by running a generator in `--check`/read-only
mode — but nothing re-runs the SAME generator in write mode before the gate, so the check
fails on stale derived state that has nothing to do with the actual change being gated.
Root-caused 2026-07-23: one PR needed 3 gate re-runs, each failing on a DIFFERENT stale
derived artifact, none related to the feature code.

**Mechanism:** extract every check/generator pairing into one shared registry (e.g.
`scripts/lib/derived-artifacts.mjs`: `{name, checkCmd, writeCmd}`), consumed by BOTH the
gate's check-mode invocations and a single `regen` entrypoint (`npm run regen` /
equivalent) that runs every generator in write mode. The registry is the single source of
truth for the pairing — a generator added to the gate is automatically added to regen,
because there is only one array to edit, not two scripts to keep in sync by hand.

**Agent-dispatch contract:** every task brief for this class of repo should include:
"final step before gating, always: run the regen entrypoint, then commit any resulting
diff, THEN gate." This converts a probabilistic multi-rerun failure into a deterministic
single pass.

**See also:** `scripts/regen.mjs` in arbiter (self-application of this pattern).

---

## 3. Content-hash, not mtime, for staleness checks

**Symptom:** a gate check compares `dist/`'s mtime against the newest `src/` file's mtime
to decide staleness. Two independent failure modes share this one root cause: (a) CI
cache-restore skew — `git checkout` resets ALL `src/` mtimes to checkout time while a
cache-restored `dist/` keeps its original (older) cache timestamp, so a cache HIT reads as
false-positive stale regardless of actual content; (b) local edit-then-verify skew — any
file-edit tool bumps a `src/` file's mtime to now, which is newer than the last local
build, so a check fails on a tiny unrelated edit even though content is fully consistent
after a rebuild that just hasn't run yet.

**Mechanism:** compare content hashes (or a cheap proxy — file names + sizes hashed
together, falling back to full content hash only on a proxy mismatch), never filesystem
timestamps, for any check whose real question is "does this generated artifact still
match its inputs." Timestamps answer "when," not "whether the content changed" — the gate
only cares about the latter.

**Validated:** arbiter's own `scripts/lib/dist-staleness.mjs` — see its fix commit and
regression tests covering both failure modes above.

---

## 4. Fail-closed, not fail-open, when the mutex binary itself is broken

**Symptom:** a gate serialization mutex (e.g. a repo-wide flock protecting a heavy,
resource-intensive local gate) is acquired via a wrapper binary. The wrapper's own
liveness check only tests "is it on PATH" (`command -v`), not "does invoking it actually
work." When the wrapper binary is present but crashing (e.g. a concurrent `npm install`
elsewhere left its own `node_modules` mid-broken), every caller sees "found on PATH,
proceed" and then the wrapper crashes before acquiring the lock — so the fail-open design
("never block a caller just because the mutex tool isn't installed") silently degrades
into "the mutex never engages for anyone," which is a materially different, far more
dangerous failure mode than the one the fail-open path was designed for.

**Mechanism:** distinguish "absent" from "present but broken" with a cheap liveness probe
(not just a presence check), and fail CLOSED on the broken case via a raw fallback lock
mechanism (e.g. plain `flock` on the same lock path the wrapper would have used) rather
than running unlocked. Reserve fail-open only for the genuinely-absent case, where running
unlocked was always the documented, intended behavior (e.g. a fresh environment that never
installed the tool).

**Corollary:** any bypass switch for this kind of safety mechanism should cost something —
require a stated reason, log it loudly (branch + timestamp + reason) — so a bypass is
always a visible, deliberate decision, never a silent default.

---

## 5. Measure before declaring victory

**Symptom:** a structural fix is designed, implemented, and assumed to have worked because
it's theoretically sound — no before/after data collected.

**Mechanism:** before implementing a throughput fix, record a real baseline (timestamped
merge/close events, not estimates). After the fix lands AND is exercised by real
subsequent work, compare the SAME metric — gate-cycles-per-issue-closed is more diagnostic
than raw merges/hour, since it isolates the mechanism being tested from unrelated
variance (issue size, reviewer availability, etc.). If the metric doesn't improve, treat
that as a real finding and go back to design — don't keep the fix on faith. A single
sample from an already-favorable case (e.g. a chain that was always going to batch well)
is not confirmation that a pattern generalizes; a second, independent sample is required
before calling a pattern proven.

---

## 6. Two mechanical levers before any clever one (#2104)

**Symptom:** a warm gate takes ten minutes and every diagnosis reaches for parallelism,
sharding, or test selection first.

**Mechanism:** profile the wall clock against the CPU clock before restructuring anything.
Two mechanical causes dominated 89% of one measured warm gate, and both are one-line fixes
now wired into the generated gate:

- **Temp dirs on tmpfs.** A suite that rebuilds a DB fixture per test (migrations replayed
  one transaction at a time) is fsync-bound, not CPU-bound. `resolveTmpfsTmpdir()` in the
  emitted `scripts/lib/run-helpers.mjs` points `TMPDIR` at `/dev/shm` before the gate spawns
  any child. Measured on the same `-count=1` coverage run: 210 s at 21% CPU on disk vs
  33.7 s at 101% CPU on tmpfs, identical user CPU. **Wall clock far above user CPU is the
  tell** — that gap is I/O wait, and no amount of parallelism recovers it.
  The guard is FREE SPACE, never `existsSync`: `/dev/shm` exists in every Linux container
  but defaults to 64 MB there, and `TMPDIR` also relocates Go's build work dirs when
  `GOTMPDIR` is unset — so an existence check ENOSPCs a containerised runner while staying
  green locally.
- **Don't split a shared build/test cache.** The Go `coverage profile` step used to pin
  `-covermode=atomic` while `debt-lib.mjs` re-ran the same suite with the default covermode
  in the same gate. covermode partitions Go's test cache, so the pin turned that second pass
  into a full 231.4 s re-run; aligned, it is a 0.77 s cache hit (52/52 packages cached) with
  identical statement coverage. Generalises past Go: **any two steps in one gate that run
  the same work under different cache keys pay for it twice.** Audit the flags that feed a
  toolchain's cache key (covermode, feature flags, `TMPDIR` itself) for accidental divergence.

  **The sibling you talk yourself out of (#2106).** The same pin survived one more round in
  `scripts/evidence-collect.mjs`, spared on the reasoning that evidence collection runs on a
  fresh CI checkout where a cold cache makes the pin free. Nobody checked. It runs nowhere in
  CI — the workflow jobs _named_ `evidence-collect` write a summary file inline and never
  invoke the script; the script is operator-run, in the same working tree as the gate, against
  a warm cache. **An audit that exempts a call site on an unverified assumption about where it
  runs has not audited it.** Grep for the invocation before granting the exemption.

**Corollary:** the same audit catches correctness bugs, not only slow ones. Pruning nested
checkouts in `walkRepo` (a git worktree or submodule inside the working tree carries its own
`.git` and belongs to a different commit) cut one repo's secret scan from 62,974 files to
20,528 — and stopped the debt ratchet counting another branch's TODO and failing the gate on
main. A walker that measures the wrong tree is slow AND wrong.
