# DEEPCORE — Dispatch Playbook

How to hand SPEC3 briefs to worker sessions without them stomping each other.
Repo: `git@github.com:PedroCamargoLINCE/deepcore` (private) · working copy:
`/home/pedro/Documents/games/deepcore` · master session = orchestrator.

---

## The one real hazard: shared hot files

Almost every brief touches `render.js`; several touch `art.js` and `barks.js`.
Two sessions editing the same working tree at the same time **will** clobber
each other (we already watched agents sweep each other's files into commits
with `git add -A`).

| Brief | Files it owns |
|---|---|
| M-POLISH | **data.js (values)**, art.js, barks.js, sim.js, render.js, engine.js, README, test/balance.js |
| M-ANIM-1/2 | **new js/fx.js**, render.js (tile + screen draw paths), engine.js (hook) |
| M-RECAP | meta.js, engine.js, render.js (new screen), barks.js |
| M-MANUAL | art.js (manual), render.js (help screen), engine.js (keys), vendor/, tools/build.js |
| M-CORELORE | barks.js, sim.js (3 events), render.js (gold style), art.js |
| M-GRITPLUS | barks.js, art.js, engine.js (420 buffer), render.js (tint) |
| M-WONDERS | map.js, sim.js, data.js (additive), render.js, barks.js |
| M-EVENTS | **new js/events.js**, sim.js, engine.js, meta.js, render.js, barks.js, art.js |

**Rules that follow from the table:**

1. **M-POLISH runs alone, on `master`.** It owns balance and touches
   everything. Nothing else runs until it merges.
2. **Everything after that runs in a git worktree on its own branch**, one
   branch per brief, merged back by this session. Parallel sessions never
   share a working tree.
3. **Max 3 parallel workers**, and never two that rebuild the same *region* of
   a file (M-MANUAL and M-ANIM both touch render.js but different screens —
   fine; two barks-heavy briefs like M-CORELORE and M-GRITPLUS go in the
   *same* session, as SPEC3 §Z already pairs them).
4. Worker sessions **push their branch and stop**. They never merge to master,
   never rebase, never force-push. The orchestrator merges.

---

## Dispatch order (from SPEC3 §Z)

| Wave | Session A | Session B | Session C |
|---|---|---|---|
| 1 | **M-POLISH** (alone, on master) | — | — |
| 2 | M-ANIM-1 + M-ANIM-2 | M-RECAP | M-MANUAL |
| 3 | M-CORELORE + M-GRITPLUS | M-WONDERS | — |
| 4 | M-EVENTS (big) | — | — |
| 5 | M-MANTLE + M-SCHEMS2 | M-TIER2 | — |
| 6 | M-WORMS | M-ACHIEVE + M-RIGSKINS | M-SOUND |

Model/effort per worker: **Opus 5, effort `xhigh`**. Use `ultracode` only for
**M-POLISH** (find→verify→fix fans out well) and **M-EVENTS** (20 vignettes
can be written in parallel then tone-edited). Everything else: one focused
session — big fan-outs burn the session limit fastest, and three fleets have
already died to it.

---

## Paste-ready prompts

### Wave 1 — M-POLISH (run this one first, alone)

```
Work in /home/pedro/Documents/games/deepcore on the master branch (no worktree —
you are the only session running).

Read SPEC.md, SPEC2.md, and SPEC3.md section M-POLISH in full, plus js/data.js.
Honor SPEC3's rules of engagement at the top of that file. Implement the
M-POLISH brief completely: all 11 CX findings, the leftover-concerns backlog,
and the balance sweep (test/balance.js) with data.js tuned toward SPEC.md §12
targets. You are the ONLY brief permitted to change existing data.js values.

Gate: all four suites green (node test/headless.js, test/integration.js,
test/barks_test.js, test/rig_test.js) plus your new test/balance.js, and
node tools/build.js parses. Checkpoint-commit after every green milestone with
a Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com> trailer.
Push to origin master when green. Report: what you fixed, the before/after
balance numbers, what you skipped and why.
```

### Wave 2+ — generic worker prompt (fill the blanks)

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
[BRIEF-ID] and do all your work there — another session is working in the main
tree at the same time, so never edit the main working copy.

Read SPEC.md, SPEC2.md, and SPEC3.md section [BRIEF-ID] in full, plus js/data.js
(and SPEC3 §A if your brief references the animation tables). Honor SPEC3's
rules of engagement at the top of that file: character-grid identity is law;
dependencies allowed only when they demonstrably improve play, vendored and
inlined by tools/build.js (rule 7); sim/map/meta/art/barks stay DOM-free and
deterministic on run.rng; GRIT's voice guardrails; data.js additive only.

Implement the brief exactly. Where it names another module as a dependency
hook, guard it so an absent feature is a no-op.

Gate: all four test suites green and extended to cover your feature, and
node tools/build.js still parses. Checkpoint-commit after every green
milestone with a Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
trailer. When done: push your branch to origin and STOP — do not merge to
master, do not rebase, do not force-push. Report: what you built, what you
deviated from the brief on and why, your final test output, and anything the
orchestrator must know to merge cleanly (files/regions you rewrote wholesale).
```

Fill `[BRIEF-ID]` with exactly one of: `M-ANIM` (covers both ANIM briefs),
`M-RECAP`, `M-MANUAL`, `M-CORELORE-GRITPLUS`, `M-WONDERS`, `M-EVENTS`,
`M-MANTLE-SCHEMS2`, `M-TIER2`, `M-WORMS`, `M-ACHIEVE-RIGSKINS`, `M-SOUND`.

---

## Orchestrator loop (this session, after each worker reports)

1. `git fetch origin && git log --oneline origin/[branch]` — read what landed.
2. Merge in **least-conflict-first** order; for render.js conflicts, prefer
   keeping both regions (the briefs are written to touch different screens).
3. Run all suites + `node tools/build.js` on the merged tree. Fix integration
   seams (that is orchestrator work, not worker work).
4. Commit the merge, push master, republish the artifact so the shared link
   tracks the latest build.
5. Dispatch the next wave.

**Cross-brief gotcha:** M-POLISH fixes the manual's wrong constants (CX-02/03)
and M-MANUAL later rebuilds that manual from scratch — the M-MANUAL worker must
re-derive every stated number from `js/data.js` at its own HEAD rather than
trusting the old text. Same shape of hazard whenever a later brief rewrites a
file an earlier one patched.
