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
| M-ONBOARD | sim.js (cause messages), engine.js (tutorial steps), meta.js (seen flag), barks.js, render.js (SCAN reason line) |
| M-WIDE | **data.js (COLS)**, render.js (all layout + new CHAIN panel), art.js (boxed assets) |
| M-HIRES | render.js (**metrics/scaling — the whole file's coordinate basis**), style.css, art.js (rasterizer), engine.js (resize), vendor/, tools/build.js |

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
| 1 | ~~M-POLISH (alone, on master)~~ ✅ **merged 2026-08-11** | — | — |
| 2 | ~~M-ANIM-1 + M-ANIM-2~~ ✅ | ~~M-RECAP~~ ✅ | ~~M-MANUAL~~ ✅ **all merged 2026-08-11** |
| 2.5 | ~~M-HIRES (alone)~~ ✅ **merged 2026-08-12** | — | — |
| 3 | ~~M-CORELORE + M-GRITPLUS~~ ✅ | ~~M-WONDERS~~ ✅ **merged 2026-08-12** | — |
| 4 | ~~M-EVENTS (big)~~ ✅ **merged 2026-08-12** (rescued by patch — see cloud notes) | — | — |
| 4.5 | ~~M-ONBOARD Part 1 (diagnostics)~~ ✅ **merged 2026-08-14** (rescued by patch) | — | — |
| 4.6 | ~~M-WIDE (alone; changed COLS 80→112)~~ ✅ **merged 2026-08-17** | — | — |
| 4.7 | ~~M-ONBOARD Part 2 (the tutorial)~~ ✅ **merged 2026-08-17** | — | — |
| 5 | ~~M-TIER2 (alone)~~ ✅ **merged 2026-08-18** — worker died at its session limit with all checkpoints pushed; rescued from its worktree, one finished diff committed for it | ~~M-MANTLE + M-SCHEMS2~~ ✅ **merged 2026-08-19** — survived THREE worker deaths (ECONNRESET, connection drop, rate limit-on-wrong-model) with zero pushed work lost | — |
| 6 | ~~M-WORMS~~ ✅ **merged 2026-08-19** | ~~M-ACHIEVE + M-RIGSKINS~~ ✅ **merged 2026-08-23** (first Fable worker, by order) | ~~M-SOUND~~ ✅ **merged 2026-08-23** (ran in parallel with B; M1 spec recovered from git history) |
| 6.5 | ~~M-CONTRACTS~~ ✅ **merged 2026-08-24** (Fable, by order; first monitored worker) | — | — |
| 7 | **M-HUMANBAL — alone, LAST — NEXT** (SPEC3 §M-HUMANBAL): thirteen findings decided as a set; everything else is merged | — | — |

**M-HUMANBAL is a running ledger, not a queued brief.** Every balance problem
the director hits while actually playing gets appended to SPEC3's M-HUMANBAL
section as it is reported — symptom in his words, the arithmetic underneath it,
candidate fixes — and NOTHING is fixed at the time. They are dispatched together
at the end, because several findings push the same numbers the same way and
fixing them one at a time overshoots. When he reports a balance problem mid-wave,
the correct response is to verify it against the code, write it into the ledger,
and say so — not to patch it.

**Why M-ONBOARD Part 1 jumped the queue.** The director found it by playing:
he could not get an extractor working while all five suites were green. It is
~150 lines, it unblocks his playtesting of everything after it, and it collides
with M-TIER2 on both `sim.js` and `render.js` — so the two run in sequence, not
in parallel. Prompt: `docs/prompts/M-ONBOARD-1.cloud.txt`.

**Why M-TIER2 goes first and alone in wave 5.** SPEC3 §Z pairs it with
M-MANTLE + M-SCHEMS2 in parallel, but two things argue against that:

1. **They collide on a decision, not just a file.** M-TIER2's underground belt
   pair partially obsoletes M-SCHEMS2's Ghost Belts — SPEC3 says outright
   "pick ONE". Run in parallel, both sessions decide independently and one of
   them is wrong. **The call is made: keep underground belts, CUT Ghost Belts
   from M-SCHEMS2.** M-SCHEMS2's prompt must say so, which it can only do once
   M-TIER2 has actually landed them.
2. **M-SCHEMS2 keys schematics to buildings.** Four of M-TIER2's schematics are
   for buildings that do not exist yet. A schematic batch written against a
   logistics layer that is still moving is a batch written twice.

M-TIER2 is also the highest-risk brief left: it rewrites belt push mechanics,
the thing every other system feeds through. It deserves an empty board.

**Why M-HIRES runs alone at 2.5:** it turns `render.js`'s `CW`/`CH` from
constants into runtime values — the coordinate basis every other draw path is
written against. Anything editing `render.js` concurrently merges badly, and
anything merged *after* it needs its new metrics anyway. Run it in its own
wave, with nothing beside it. It slots after Wave 2 only because Wave 2 was
already dispatched; on a clean board it would be worth doing first, since
"the game fills my monitor" is the most visible single change left.

Model/effort per worker: **Opus 5, effort `high`, 1M context** — model id
`claude-opus-5[1m]` (director's call, 2026-08-18; see the note below the
prompts list — `xhigh` is now by exemption only). The 1M variant is selected
with the CLI flag (`--model "claude-opus-5[1m]"`); the orchestrator's in-session
Agent tool only offers the plain `opus` alias, which is acceptable for
worktree workers since briefs are sized to fit. The MASTER session (the
orchestrator) is not covered by this default — the director runs it on
Fable 5 by his own /model setting. Use `ultracode` only for
**M-POLISH** (find→verify→fix fans out well) and **M-EVENTS** (20 vignettes
can be written in parallel then tone-edited). Everything else: one focused
session — big fan-outs burn the session limit fastest, and three fleets have
already died to it.

---

## Paste-ready prompts

Every prompt below is **complete — no blanks to fill**. Open a new session in
`/home/pedro/Documents/games/deepcore`, paste one, and walk away. Sessions in
the same wave run at the same time; wait for a wave to merge before the next.

Model/effort for all of them: **Opus 5, effort `high`, 1M context**
(`--model "claude-opus-5[1m]"` — director's calls, 2026-08-17/18). `xhigh` was
the old default and is no longer used for routine briefs — raise it only for a
brief the director has explicitly exempted, and say so when you dispatch.
M-TIER2 was granted that exemption and ran at `xhigh`, because it rewrites the
logistics layer every other system feeds through. The master session stays on
whatever the director sets it to (currently Fable 5); this default is for
WORKERS.

### Running a brief LOCALLY, watchable from the phone (the standard way)

The canonical worker launch, learned the expensive way on 2026-08-18:

```bash
tmux new-session -d -s laborer -c <worktree-path> \
  'claude --remote-control "THE-LABORER-<BRIEF>" \
     --model "claude-opus-5[1m]" --effort high \
     --permission-mode bypassPermissions "<prompt or continuation kick>"'
```

**THE MODEL RULE (director's law, 2026-08-19, amended the same day):** the
model a worker runs on is the DIRECTOR'S choice, per dispatch, and it is
ALWAYS pinned explicitly on the command line and verified from the transcript
stamps afterward. Fable is the director's own model: a worker runs on it only
when he says so for that dispatch (he opened that door on 2026-08-19 — "i want
to try using fable 5 for the workers"), never by default, never by
inheritance. Which means: never launch anything whose model you cannot
directly and explicitly control. If a launch
mechanism has no --model (or equivalent) parameter, or its override is not
verifiable, that mechanism is FORBIDDEN for workers — regardless of what the
account default happens to be that day, because the default is the director's
to change and yours to never depend on. Every launch pins the model
explicitly; every launch is verified from the transcript stamps afterward.

**Fourth rule, from the director (2026-08-24): every worker gets a MONITOR
the moment it launches.** A worker that dies to a connection drop sits idle at
its prompt, silently, until somebody looks — M-CONTRACTS lost an hour that way
and was only found because the director asked "how is it going". The
orchestrator arms a persistent Monitor on the worker's tmux pane and branch,
polling every 5 minutes (director's call — 30s was too chatty) and emitting on exactly the states it would act on:
`ERROR:` (API Error / Connection lost / limit / Overloaded — the nudge is
`tmux send-keys -t laborer "<continue>" Enter Enter`), `STALLED:` (idle at the
prompt 5+ min), `DEAD:` (tmux session gone — resume the session by id with
the model re-pinned), `PUSHED:` (a new checkpoint on origin — progress), and
`DONE?:` (the worker's own finished recap). Silence is not success: the
filter must cover every failure signature, not just the happy path.

Four rules, each paid for:

1. **The `--remote-control` FLAG, never the `claude remote-control` server
   subcommand, for workers.** The subcommand has NO --model option — its
   sessions silently inherit the account's default model, and on the day the
   director's default was Fable it burned 233 turns of his Fable limit on a
   worker that was ordered to be Opus. The flag variant pins --model and
   --effort on the command line, and a pinned model survives --resume (proven:
   a session resumed with the flag stamped opus 210/210).
2. **Inside tmux, never headless.** --remote-control asks "Enable Remote
   Control? (y/n)" interactively; headless (stdin /dev/null) that prompt can
   never be answered, the session never registers with the server, it is
   invisible on the phone, and later --session-id reattachment fails because
   the server has never heard of it. tmux gives it a real TTY; answer prompts
   with `tmux send-keys -t laborer 'y'`.
3. **Verify, don't assume.** After launch, the session's model is provable:
   grep the newest .jsonl under ~/.claude/projects/<worktree-slug>/ for
   '"model":"claude-...' stamps — the newest turns must stamp the intended
   model. The in-session Agent tool's `model` parameter was also observed NOT
   to hold for background workers; agents are for small errands where the
   model does not matter.
4. **Session DISPLAY names are one shared slot — never trust them, never
   `/rename` from a worker pane** (2026-08-25). A `/rename` sent into any
   session's pane changed the banner of EVERY session on the machine,
   including the master's — the director watched "deepcore-master" become
   a laborer on his own screen, and earlier saw a phone entry named
   deepcore-master that was actually the rockore worker. The only name that
   is genuinely per-session is the Remote Control REGISTRATION: pass it
   explicitly at launch (`--remote-control "THE-LABORER-<BRIEF>"`) and on
   every re-register (`/remote-control THE-LABORER-<BRIEF>` — never bare;
   a bare re-register grabs the shared display name and impersonates
   whoever owns it). If a launch prints "Session creation failed", the
   retry also carries the name. Cleaning up a mess: disconnect each remote
   from its own pane (`/remote-control` → Disconnect), re-register each
   with its explicit name, and the master re-registers as itself
   (`/remote-control deepcore-master`) — by the director's hand, since the
   orchestrator cannot run slash commands in its own session.
   Per the official Remote Control docs (checked 2026-08-25): the phone list
   title resolves in priority order (1) the name passed to
   `--remote-control <name>`, (2) `/rename`, (3) last message, (4) an
   auto-generated `host-adjective-noun` — so an explicit registration name
   OUTRANKS the rename mess, which is why the incantation always carries
   one. The all-sessions-flip on `/rename` is documented NOWHERE and is a
   local bug (three sessions, same repo, different worktree dirs); treat
   banners and ListAgents names as unreliable, identify workers by tmux
   session name and branch.

### Running a brief in a CLOUD session (laptop closed)

`claude --cloud "M-WONDERS: stratum landmarks"` runs the session on Anthropic's
infrastructure instead of this laptop, so the machine can sleep. Reattach with
`claude --cloud <session_id>` or from claude.ai/code on a phone. (Not to be
confused with `--remote-control`, which drives a session *on this laptop* from
elsewhere — that one still needs the laptop awake.)

**The whole invocation, so it is never re-derived:**

```bash
cd /home/pedro/Documents/games/deepcore

claude --cloud "M-ONBOARD-2: GRIT teaches the tutorial" \
  --model "claude-opus-5[1m]" --effort high \
  --permission-mode bypassPermissions \
  "$(cat docs/prompts/M-ONBOARD-2.cloud.txt)"
```

Three details that are easy to get wrong:

- **`--cloud` takes a short DESCRIPTION, not the prompt.** The prompt is the
  positional argument, last (`claude [options] [command] [prompt]`). Swap them
  and you launch a session whose entire instruction is its own title.
- `--permission-mode bypassPermissions` is what makes it walk-away. `acceptEdits`
  lets edits through but still stops at Bash, so an unattended session stalls at
  the first `node test/headless.js`. Bypassing is a different proposition in the
  cloud than locally: the container is isolated and has no reach into this
  machine.
- **Push master before dispatching.** The session clones the remote, not this
  working copy, so an unpushed merge means the worker builds on the wrong tree.
  Check with `git log --oneline origin/master..master` — it should be empty.

**Monitoring needs no flag.** A cloud session *is* a claude.ai/code session —
that is why `--cloud` reattaches by "session ID or claude.ai/code URL" — so it
appears in the web and phone apps on its own, watchable and interruptible from
anywhere. Do **not** reach for `--remote-control` here: that exposes a session
running *on this laptop*, which is the dependency a cloud session exists to
remove. It is the opposite tool, not an addition.

Two more cloud flags worth knowing:

- `--ref <branch|tag|SHA>` pins the base the session starts from. Optional,
  since the repo's default branch is already `master`.
- `--on-branch <name>` starts a NEW cloud session continuing an existing
  branch. This is the recovery path: a brief whose session dies is not
  restarted, it is resumed from its last pushed checkpoint — which is the whole
  reason the checkpoint rule now pushes.

**A private repo needs the GitHub App granted access, or the session cannot
push.** M-EVENTS hit this: the cloud clone had no `origin` remote and its
`GH_TOKEN` got a 403 from `api.github.com/repos/PedroCamargoLINCE/deepcore`, so
six finished commits were stranded in the workspace. Grant access once at
**github.com/settings/installations** -> Claude -> add `deepcore`, and cloud
sessions clone and push normally.

If a session is already stranded, do not abandon it — the work is recoverable:

- `cd` into the repo and `claude --teleport <session_id>`. Teleport moves a
  session between cloud and local and carries git state as a bundle
  (`teleport_git_bundle_upload`), so the branch comes with it. Run it from the
  REPO ROOT: the CLI checks for a repo mismatch.
- Failing that, `git format-patch master..<branch> --stdout` in the session and
  `git am` the result locally. Clumsy for a large brief, but a guaranteed floor.

The prompts below assume a local machine. Two substitutions make any of them
cloud-ready:

1. **Drop the path and the worktree paragraph.** Replace
   *"Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
   X and do ALL your work there — another session is working in parallel, so
   never edit the main working copy. Branch from current origin/master."*
   with:
   *"Work in this repository. Create and switch to a branch named X off
   origin/master, and do all your work on it."*
   A cloud session gets its own checkout, so the shared-working-tree hazard the
   worktree rule exists to prevent does not apply there — the branch does.

2. **Everything else stays exactly as written**, including push-and-stop: the
   orchestrator still merges.

**Why the checkpoint rule now says commit AND PUSH.** A worker's commits live
only on its own disk until it pushes, and it used to push once at the end. A
laptop that sleeps mid-brief, or a cloud session that hits a limit, then leaves
hours of green work reachable only from that machine. Pushing each checkpoint
costs a second and makes every milestone recoverable from anywhere — which is
the whole point of moving off the laptop.

---

### The preamble (already included in each prompt — here so you know what it does)

Every worker prompt carries the same five paragraphs: where to work (a worktree
on its own branch), what to read, the rules of engagement, the test gate, and
the push-and-stop rule. The only thing that changes between them is the brief
and its cross-brief notes. If you ever need a prompt for a brief not listed
here, copy the nearest one and swap those two parts.

---

### Wave 1 — M-POLISH ✅ DONE (merged to master 2026-08-11)

Kept for reference; do not re-run. It fixed the 11 CX findings, repaired
`test/balance.js`, and retuned `data.js` (instability −35%, deep breach costs
−27%, quake damage softened). All five SPEC §12 targets pass.

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
node tools/build.js parses. Checkpoint-commit AND PUSH your branch after every green milestone, with
a Co-Authored-By: Claude Opus 5 <noreply@anthropic.com> trailer.
Push to origin master when green. Report: what you fixed, the before/after
balance numbers, what you skipped and why.
```

---

### Wave 2A — M-ANIM (both halves, one session)

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-ANIM and do ALL your work there — two other sessions are working in parallel,
so never edit the main working copy. Branch from current origin/master.

Read SPEC.md, SPEC2.md, and SPEC3.md §A IN FULL (both tables A1 and A2, plus
the contracts paragraph that closes the section), and js/data.js. IMPORTANT:
§A *is* the M-ANIM brief — there is no "### M-ANIM" heading in §B, so do not go
looking for one. Every row of A1 and A2 is an acceptance criterion. You are
implementing BOTH halves: M-ANIM-1 (machines & world, A1) and M-ANIM-2 (screen
moments & particles, A2).

Honor SPEC3's rules of engagement at the top of that file: the character-grid
identity is law; dependencies only when they demonstrably improve play,
vendored and inlined by tools/build.js (rule 7); sim/map/meta/art/barks stay
DOM-free and deterministic on run.rng; GRIT's voice guardrails; js/data.js is
ADDITIVE ONLY (M-POLISH owns its existing values and has already retuned them).

Build the new module js/fx.js (DC.FX) owning a frame clock and a small particle
list, drawn as the last overlay. HARD CONSTRAINT: zero sim edits. Everything
derives from state that already exists (run.quakeAt, machine.job/status, tile
fields). Render may PEEK run.events but must never consume them — the engine
still drains that queue. The FX frame clock is render-side only and must never
feed back into the sim; determinism is non-negotiable.

Ship row by row: land one table row, commit, land the next. Do NOT build all of
fx.js before the first thing moves on screen — if the session dies, that gets us
a working belt animation instead of a half-written module. Add js/fx.js to
index.html AND tools/build.js's script list.

Gate: all five suites green (node test/headless.js, test/integration.js,
test/barks_test.js, test/rig_test.js, test/balance.js) and node tools/build.js
parses. Extend the suites with a stub-canvas frame-advance test proving each
table row fires under a constructed state. Checkpoint-commit AND PUSH your
branch after every green milestone with a Co-Authored-By: Claude Opus 5 <noreply@anthropic.com> trailer.

When done: push your branch to origin and STOP — do not merge to master, do not
rebase, do not force-push. Report: what you built, which table rows you did or
did not land and why, your final test output, and anything the orchestrator must
know to merge cleanly (files/regions you rewrote wholesale).
```

### Wave 2B — M-RECAP

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-RECAP and do ALL your work there — two other sessions are working in
parallel, so never edit the main working copy. Branch from current
origin/master.

Read SPEC.md, SPEC2.md, and SPEC3.md section M-RECAP in full, plus js/data.js.
Honor SPEC3's rules of engagement at the top of that file: character-grid
identity is law; dependencies only when they demonstrably improve play,
vendored and inlined by tools/build.js (rule 7); sim/map/meta/art/barks stay
DOM-free and deterministic on run.rng; GRIT's voice guardrails; js/data.js is
ADDITIVE ONLY (M-POLISH owns its existing values and has already retuned them).

You own meta.js, engine.js, render.js (your new screen only) and barks.js.
Another session is adding animation to render.js's tile and screen draw paths
at the same time — keep your work inside your own screen's draw function so the
merge stays clean, and do not refactor shared render helpers.

Anything you persist to the save must survive an older save loading: guard every
new field with a default so a profile written before your change still loads.

Gate: all five suites green (node test/headless.js, test/integration.js,
test/barks_test.js, test/rig_test.js, test/balance.js) and node tools/build.js
parses, with the suites extended to cover your feature. Checkpoint-commit after
every green milestone with a Co-Authored-By: Claude Opus 5
<noreply@anthropic.com> trailer.

When done: push your branch to origin and STOP — do not merge to master, do not
rebase, do not force-push. Report: what you built, what you deviated from the
brief on and why, your final test output, and anything the orchestrator must
know to merge cleanly.
```

### Wave 2C — M-MANUAL

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-MANUAL and do ALL your work there — two other sessions are working in
parallel, so never edit the main working copy. Branch from current
origin/master.

Read SPEC.md, SPEC2.md, and SPEC3.md section M-MANUAL in full, plus js/data.js.
Honor SPEC3's rules of engagement at the top of that file: character-grid
identity is law; dependencies only when they demonstrably improve play,
vendored and inlined by tools/build.js (rule 7); DOM-free determinism;
js/data.js is ADDITIVE ONLY (M-POLISH owns its existing values).

CRITICAL — read this before you write a single number. M-POLISH just rebuilt
the manual to COMPOSE its numbers from js/data.js at load time, precisely so
the manual can never drift from the sim again (it had said 40 where the sim
vented 45, and 22 where quakes started at 25). You are rewriting that manual's
layout. Every stated number must still be READ FROM DC.DATA at composition
time — never typed as a literal, never copied from the old text, never copied
from SPEC.md (which can itself lag data.js). test/barks_test.js asserts this;
do not weaken those assertions to make a hand-written layout pass.

The brief is a redesign for CONTRAST and legibility: the current manual is
blocky and unpleasant to read. That is the actual goal — a player should be
able to find one fact fast. You may use a vendored font or dependency if it
genuinely helps (rule 7), inlined by tools/build.js, no CDN links; file:// must
keep working.

You own art.js (the manual), render.js (the help screen only), engine.js (keys),
vendor/, and tools/build.js. Another session is adding animation to render.js's
tile and screen draw paths at the same time — stay inside the help screen.

Gate: all five suites green (node test/headless.js, test/integration.js,
test/barks_test.js, test/rig_test.js, test/balance.js) and node tools/build.js
parses. Checkpoint-commit AND PUSH your branch after every green milestone, with a Co-Authored-By:
Claude Opus 5 <noreply@anthropic.com> trailer.

When done: push your branch to origin and STOP — do not merge to master, do not
rebase, do not force-push. Report: what you built, what you deviated on and why,
your final test output, and confirmation that every manual number is composed
from data.js rather than typed.
```

---

### Wave 2.5 — M-HIRES (alone; nothing else may touch render.js)

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-HIRES and do ALL your work there. Branch from current origin/master. You are
the ONLY session running this wave — you are changing render.js's coordinate
basis, so nothing else may touch that file while you work.

Read SPEC.md, SPEC2.md, and SPEC3.md section M-HIRES in full, plus js/render.js
(especially init(), flush() and pxToCell()) and js/data.js. Honor SPEC3's rules
of engagement at the top of that file.

The brief has five phases, ordered by value-per-risk. SHIP EACH AND COMMIT IT
before starting the next — Phase 1 alone is most of the value the director
asked for, and a session limit mid-Phase-3 must not cost us the working
scaling.

  Phase 0: fx.js's frame clock counts requestAnimationFrame callbacks while
           assuming 60fps, and engine.js does not throttle — so frame-measured
           animations run 2-2.4x too fast on a 120/144Hz monitor. Small fix,
           drive the clock from elapsed milliseconds. Details in the brief.
  Phase 1: the canvas is a fixed 800x627 island on any real monitor because
           init() sets a CSS pixel size once on load and there is no resize
           handler anywhere in the codebase. Make it fill the viewport,
           preserving aspect. Canvas text is RE-RENDERED at the new size, not
           upscaled, so this genuinely sharpens rather than stretches.
  Phase 2: sub-cell resolution using block elements, which are already in the
           font — no dependency needed.
  Phase 2.5: vendor a SUBSET of a full-Unicode monospace (not a code page — read
           vendor/README.md for why CP437 was rejected) so the grid renders the
           same on machines we cannot test. Traps: Render.init() measures the
           glyph advance once at startup and a webfont loads asynchronously, so
           it needs a re-measure on document.fonts.ready — the same fix Phase 1
           already needs for resize. Keep the system stack as fallback.
  Phase 3: braille, ONLY behind that vendored font plus a runtime coverage
           probe and a block-element fallback.

VERIFY THIS BEFORE WRITING PHASE 3, and do not take it on faith from the brief:
DejaVu Sans Mono does NOT contain braille (U+2800-28FF) — those codepoints fall
back to the PROPORTIONAL DejaVu Sans face. This is not cosmetic. flush() batches
a whole run of cells into one fillText scaled by CW/adv, where adv is measured
from the block glyph, so a single proportional fallback glyph slides every
character after it out of its cell and corrupts the row. Ship the runtime probe
even with a vendored font: browsers block webfonts, and the failure mode is a
corrupted row rather than a missing dot.

DO NOT sub-cell the map tiles. The map is interactive — pxToCell maps a click to
a cell and every tile is a semantic, clickable, one-glyph object. Sub-cell
resolution goes on the NON-interactive surfaces: the rig portrait, the victory
core sphere, gauges and bars (eighths instead of whole cells), title art. That
is a hard design constraint from the brief and from SPEC3 §0's 'chunky beats
smooth' law, not a preference.

art.js stays DOM-free and pure: the rasterizer must be unit-testable in bare
node with no canvas. Zero sim changes. js/data.js ADDITIVE ONLY. No CDN links —
tools/build.js must inline any vendored font and file:// must keep working.

Gate: all five suites green (node test/headless.js, test/integration.js,
test/barks_test.js, test/rig_test.js, test/balance.js) and node tools/build.js
parses. Add tests for: pxToCell round-trip at three viewport sizes, the glyph
advance being re-measured after resize, the rasterizer against known bitmaps
including its cell-aspect correction, and the block fallback engaging when
braille is unavailable. Checkpoint-commit AND PUSH your branch after every green milestone, with a
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com> trailer.

When done: push your branch to origin and STOP — do not merge, rebase or
force-push. Report: which phases landed, the bundle size delta on
dist/deepcore.html, whether you vendored a font and why, and your final test
output.
```

---

### Wave 3A — M-CORELORE + M-GRITPLUS (one session — both are writing)

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-CORELORE-GRITPLUS and do ALL your work there — another session is working in
parallel, so never edit the main working copy. Branch from current
origin/master.

CONCURRENCY — M-HIRES is running right now and owns js/render.js's coordinate
basis. Read this before you touch render or art:

  - M-HIRES is rewriting ONLY the pixel-metric region of render.js: the CW/CH
    constants, flush() and init(). Every screen-drawing function works in CELL
    coordinates through text()/put(), which is where all of your work lives —
    the foreman bar's gold intrusions, the fake ASCEND prompt, the descent
    graffiti, the EGG-420 tint. Stay in the cell-coordinate draw functions and
    you will not collide. Do NOT touch flush(), init(), pxToCell(), or the
    CW/CH constants for any reason.

  - THE ONE REAL COLLISION IS THE VICTORY CORE SPHERE. M-CORELORE cracks it
    open (the egg reveal — the game's biggest narrative payoff), and M-HIRES is
    separately redrawing that same asset at higher sub-cell fidelity. So do NOT
    edit the sphere's art in place. Implement the crack as an OVERLAY: a pure
    function that takes the sphere rows as input and returns them with the
    hairline crack applied, driven by the toast's final character. Written that
    way it composes with whatever sphere exists at merge time, at any
    resolution, and neither brief has to know about the other. Same principle
    anywhere else the two briefs want the same asset.

Read SPEC.md, SPEC2.md, and SPEC3.md sections M-CORELORE and M-GRITPLUS in
full, plus js/data.js and js/barks.js. You are implementing BOTH — they are
paired deliberately because both are writing work in the same voice, and
splitting them across sessions would produce two different Foremen.

Honor SPEC3's rules of engagement at the top of that file. GRIT's voice
guardrails are load-bearing here and are NOT optional: profanity, gallows
humor, drilling innuendo and Company-hating are in bounds BY DESIGN — that is
the character. Slurs, hate, explicit anatomy, and non-consent framing are out,
always. M-POLISH already removed one non-consent line (CX-10); do not
reintroduce that shape. The Core's voice must read as a DIFFERENT character
from GRIT — that contrast is the whole point of M-CORELORE.

M-GRITPLUS includes EGG-420, the marijuana easter egg. Keep it a genuine easter
egg: discoverable, funny, never gating progression. Its green wash obeys SPEC3
§0 law 6 — readability is a primary objective, not a constraint. The brief says
"tint, don't paint" and means it: if the map reads worse during those 42
seconds, the effect is wrong no matter how funny the bit is. Same test for the
Core's gold intrusions — vast and amused still has to be legible against the
foreman bar's background at the contrast floor M-POLISH set.

Both briefs name other modules as dependency hooks (M-ANIM-2's descent
interstitial slot, M-EVENTS' dig-find weight). Those may not exist in your tree.
GUARD EVERY HOOK so an absent feature is a silent no-op — never a crash, never a
hard dependency. sim/map/meta/art/barks stay DOM-free and deterministic on
run.rng. js/data.js ADDITIVE ONLY.

Gate: all five suites green (node test/headless.js, test/integration.js,
test/barks_test.js, test/rig_test.js, test/balance.js) and node tools/build.js
parses. test/barks_test.js enforces the voice lint, line-overlap ceiling and
panel-wrap contract — every new line must pass it, including that it word-wraps
whole into the LOG (3x29) and the Foreman bar (2x41). Checkpoint-commit after
every green milestone with a Co-Authored-By: Claude Opus 5
<noreply@anthropic.com> trailer.

When done: push your branch to origin and STOP — do not merge, rebase or
force-push. Report: what you wrote, line counts per category, which hooks you
guarded, and your final test output.
```

### Wave 3B — M-WONDERS

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-WONDERS and do ALL your work there — another session is working in parallel,
so never edit the main working copy. Branch from current origin/master.

Read SPEC.md, SPEC2.md, and SPEC3.md section M-WONDERS in full, plus js/data.js
and js/map.js. Honor SPEC3's rules of engagement at the top of that file.

You are touching MAPGEN, which is the most failure-prone module in the project:
a landmark that overwrites an ore vein or walls off a region turns a run
unwinnable in a way that only shows up seeds later. Non-negotiable invariants —
every generated map must keep its guaranteed iron and coal veins reachable, and
the connectivity carve must still connect every region to the rig. Extend
test/headless.js to assert both across many seeds WITH landmarks present, and
run test/balance.js (14 seeds x 2 policies) before and after: the survive-
stratum-2 rate must not regress. Read that harness's footer first — it explains
which failures are the bot's ceiling rather than the game's.

You may add to js/data.js ADDITIVELY (new landmark definitions are fine);
you may NOT change existing values — M-POLISH owns those and has already
retuned them against the balance targets.

sim/map stay DOM-free and deterministic on run.rng: no Date.now, no
Math.random, ever. A landmark must generate identically for the same seed.

Gate: all five suites green and node tools/build.js parses. Checkpoint-commit
after every green milestone with a Co-Authored-By: Claude Opus 5
<noreply@anthropic.com> trailer.

When done: push your branch to origin and STOP — do not merge, rebase or
force-push. Report: what you built, your before/after balance numbers, and
anything the orchestrator must know to merge cleanly.
```

---

### Wave 4 — M-EVENTS — CLOUD-READY PROMPT AT `docs/prompts/M-EVENTS.cloud.txt`

Dispatch it without tying up the laptop. **Run this from the repo root** — use
the absolute path so it cannot matter where you are:

```
cd ~/Documents/games/deepcore && claude --cloud "M-EVENTS: vignettes and the cave-cat" \
  "$(cat ~/Documents/games/deepcore/docs/prompts/M-EVENTS.cloud.txt)"
```

> **Check the shell output before walking away.** `~/Documents/games` is the
> PARENT of the repo and is not a git repository. Run the command there and two
> things fail quietly: `cat` prints "No such file or directory" so the prompt
> arrives EMPTY, and the session has no repository to attach to — yet a cloud
> session is still created and prints a perfectly healthy-looking URL. It is
> named from the description, so it looks right and does nothing. If you see
> that `cat:` error, abandon the session and re-run from the repo root.

`--cloud` is **interactive only** — it refuses `--print`, so it cannot be
launched from a script or by an agent. A human has to start it; the command
above seeds it in one go so that is the only manual step.

That file is the local prompt below with the two cloud substitutions applied
(branch instead of worktree, no absolute path), plus a paragraph the local
version predates: Waves 1–3 have merged, so `js/fx.js`, `DC.Barks.CORE`,
landmarks and EGG-420's dig-find route all EXIST now and should be wired rather
than guarded away. Keep the two copies in step if you edit either.

### Wave 4 — M-EVENTS, local variant (big; run it alone)

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-EVENTS and do ALL your work there. Branch from current origin/master. You are
the only session running this wave — the brief is large and touches many files.

Read SPEC.md, SPEC2.md, and SPEC3.md section M-EVENTS in full, plus js/data.js,
js/sim.js and js/barks.js. Honor SPEC3's rules of engagement at the top of that
file.

Build the new module js/events.js. Add it to index.html AND tools/build.js's
script list. It stays DOM-free and deterministic on run.rng — every vignette
must roll identically for the same seed, so no Date.now and no Math.random.
js/data.js is ADDITIVE ONLY.

The vignettes are the roguelike soul of the game and the cave-cat is the one
players will talk about — give the writing real care, and keep every voice
distinct from GRIT's. GRIT's guardrails apply to all of it: profanity and
gallows humor yes; slurs, hate, explicit anatomy and non-consent framing never.

This brief benefits from the animation layer but must not require it: guard
every render/FX hook so an absent feature is a silent no-op.

Ship vignette by vignette, committing as each lands green — this is a big brief
and a session limit mid-way should leave us with eight working events, not a
half-written module.

Gate: all five suites green (node test/headless.js, test/integration.js,
test/barks_test.js, test/rig_test.js, test/balance.js) and node tools/build.js
parses, with the suites extended to cover the event system and each vignette's
trigger. Checkpoint-commit with a Co-Authored-By: Claude Opus 5
<noreply@anthropic.com> trailer.

When done: push your branch to origin and STOP — do not merge, rebase or
force-push. Report: what you built, which vignettes landed, what you deviated
on and why, and your final test output.
```

---

### Wave 5A — M-MANTLE + M-SCHEMS2 (one session)

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-MANTLE-SCHEMS2 and do ALL your work there — another session is working in
parallel, so never edit the main working copy. Branch from current
origin/master.

Read SPEC.md, SPEC2.md, and SPEC3.md sections M-MANTLE and M-SCHEMS2 in full,
plus js/data.js. You are implementing BOTH. Honor SPEC3's rules of engagement.

M-MANTLE's mutators reshape the endless mode's difficulty and M-SCHEMS2 adds
seven schematics — both change what a long run feels like, so measure, don't
guess: run test/balance.js before and after (read its footer first — it says
which SPEC §12 target is checked under which Foundry loadout, and warns that
'no-breach' stalls at s5+ are the scripted bot's ceiling, not the game's). Use
node tools/ab.js '<js mutating D>' to A/B a tuning without editing data.js.

js/data.js is ADDITIVE ONLY: new schematics and mutator definitions are fine,
existing values are M-POLISH's and have already been retuned to hit every
SPEC §12 target. If you believe an existing value must change, do NOT change
it — report it with the balance numbers that justify it.

One mutator ('worm season') needs M-WORMS, which does not exist yet. Guard it
so an absent feature is a silent no-op. Everything stays DOM-free and
deterministic on run.rng.

Gate: all five suites green and node tools/build.js parses, extended to cover
the new schematics and mutators. Checkpoint-commit AND PUSH your branch after
every green milestone
with a Co-Authored-By: Claude Opus 5 <noreply@anthropic.com> trailer.

When done: push your branch to origin and STOP. Report: what you built, your
before/after balance numbers, and anything the orchestrator must know to merge.
```

### Wave 5B — M-TIER2

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-TIER2 and do ALL your work there — another session is working in parallel, so
never edit the main working copy. Branch from current origin/master.

Read SPEC.md, SPEC2.md, and SPEC3.md section M-TIER2 in full (it absorbs the old
ROADMAP M2), plus js/data.js and js/sim.js. Honor SPEC3's rules of engagement.

This is the strongest systems brief on the board: you are extending the
logistics layer that every other system feeds through. Belt throughput must
comfortably exceed any single machine's rate (SPEC §12) — lines may only jam
when the player under-builds, because that is the intended lesson. Preserve the
existing belt push-mechanics contract: multi-pass compression and backpressure
behave as test/headless.js asserts.

Worth knowing: the scripted bot in test/balance.js currently CANNOT build the
tier-2 chain, which is why high-Foundry runs stall at s5+ with 'no-breach' and
'crystal-noroute'. If your work makes tier-2 logistics buildable by that bot,
teaching it the chain is in scope and would lift the whole sweep's ceiling —
but tune the BOT, never data.js, to achieve it.

js/data.js ADDITIVE ONLY. sim stays DOM-free and deterministic on run.rng.

Gate: all five suites green and node tools/build.js parses, extended to cover
the new logistics. Run test/balance.js before and after and report both.
Checkpoint-commit AND PUSH your branch after every green milestone, with a Co-Authored-By: Claude
Opus 5 <noreply@anthropic.com> trailer.

When done: push your branch to origin and STOP. Report: what you built, your
before/after balance numbers, and anything the orchestrator must know to merge.
```

---

### Wave 6A — M-WORMS

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-WORMS and do ALL your work there — other sessions may be working in parallel,
so never edit the main working copy. Branch from current origin/master.

Read SPEC.md, SPEC2.md, and SPEC3.md section M-WORMS in full, plus js/data.js,
js/map.js and js/sim.js. Honor SPEC3's rules of engagement.

Worms move through the map, so they are the first thing in the game that can
make a run unwinnable by accident: a worm that eats a belt run the player cannot
rebuild, or that paths into an unreachable pocket, is a bug even when it is
"working". Bound their behavior and assert those bounds in test/headless.js
across many seeds.

Fully deterministic on run.rng — no Date.now, no Math.random. A worm must move
identically for the same seed. js/data.js ADDITIVE ONLY.

Two later briefs hook this one (M-MANTLE's 'worm season' mutator, M-ACHIEVE's
Worm Whisperer). If those exist in your tree, wire them; if not, expose a clean
API and move on.

Gate: all five suites green and node tools/build.js parses, extended to cover
worm behavior and its bounds. Run test/balance.js before and after — worms must
not regress the survive-stratum-2 rate. Checkpoint-commit with a Co-Authored-By:
Claude Opus 5 <noreply@anthropic.com> trailer.

When done: push your branch to origin and STOP. Report: what you built, your
before/after balance numbers, and the API the hook-briefs should call.
```

### Wave 6B — M-ACHIEVE + M-RIGSKINS (one session)

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-ACHIEVE-RIGSKINS and do ALL your work there — other sessions may be working
in parallel, so never edit the main working copy. Branch from current
origin/master.

Read SPEC.md, SPEC2.md, and SPEC3.md sections M-ACHIEVE and M-RIGSKINS in full,
plus js/data.js, js/meta.js and js/art.js. You are implementing BOTH — they
share the meta/save layer and the rig-portrait composition. Honor SPEC3's rules
of engagement.

Anything you persist MUST survive an older save loading: guard every new field
with a default so a profile written before your change still loads without
losing its cores or upgrades. Add a test for exactly that.

Rig liveries compose onto the existing layered rig portrait — read js/art.js's
composeRig and rigParts before designing, and keep test/rig_test.js's 617
checks green (extend, do not weaken).

One achievement (Worm Whisperer) needs M-WORMS. Guard it so an absent feature is
a silent no-op. Everything stays DOM-free and deterministic. js/data.js
ADDITIVE ONLY.

Gate: all five suites green and node tools/build.js parses, extended to cover
achievements, save migration, and each livery's composition. Checkpoint-commit
with a Co-Authored-By: Claude Opus 5 <noreply@anthropic.com> trailer.

When done: push your branch to origin and STOP. Report: what you built, how you
proved save compatibility, and your final test output.
```

### Wave 6C — M-SOUND (last)

```
Work in /home/pedro/Documents/games/deepcore. Create a git worktree named
M-SOUND and do ALL your work there — other sessions may be working in parallel,
so never edit the main working copy. Branch from current origin/master.

Read SPEC.md, SPEC2.md, and SPEC3.md section M-SOUND in full (it absorbs the old
ROADMAP M1 unchanged, plus additions), plus js/data.js. Honor SPEC3's rules of
engagement.

Sound is the one system that can make the game worse by existing. Hard
requirements: it starts MUTED or behind an explicit opt-in, the mute state
persists in the save, and audio never blocks or throttles the render loop.
Browsers refuse to start audio before a user gesture — handle that path without
console noise.

Synthesize via WebAudio rather than shipping audio files if at all possible: the
single-file build must keep working from file://, and megabytes of base64 in
dist/deepcore.html would be a real cost. No CDN links. If you vendor anything,
tools/build.js must inline it (rule 7).

The audio layer is DOM/browser-side and must never be required by sim, map,
meta, art or barks — those stay DOM-free and headless-testable. Every test suite
runs in bare node with no WebAudio: guard accordingly, so an absent AudioContext
is a silent no-op.

Gate: all five suites green in bare node and node tools/build.js parses.
Checkpoint-commit with a Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
trailer.

When done: push your branch to origin and STOP. Report: what you built, how the
mute/opt-in works, the size delta on dist/deepcore.html, and your final test
output.
```

---

## Orchestrator loop (this session, after each worker reports)

1. `git fetch origin && git log --oneline origin/[branch]` — read what landed.
2. Merge in **least-conflict-first** order; for render.js conflicts, prefer
   keeping both regions (the briefs are written to touch different screens).
3. Run **all five** suites + `node tools/build.js` on the merged tree — the
   sweep included, since a merge can change balance without touching `data.js`.
   Fix integration seams (that is orchestrator work, not worker work).
4. **Read the screen, do not just read the tests.** Every gate can be green
   while the result is ugly, and §0 law 6 makes ugly a defect. `Render.cellAt`
   plus a stub canvas dumps any screen as text in ~60 lines; render the ones the
   brief touched and *look* at them. The suites cannot tell you that a box is
   30% full or that two icons ended up the same shape.
5. Commit the merge, push master, republish the artifact so the shared link
   tracks the latest build.
6. **Re-read every queued prompt in `docs/prompts/` before dispatching it** if
   the merge changed anything global. A worker cannot see a constraint that
   landed after its brief was written, so the brief has to carry it — see the
   next note.
7. Dispatch the next wave.

**The Frankenstein hazard — never keep-both a conflict inside a function.**
Two parallel workers each appended a test section that began with the same
forty lines of engine-stub scaffolding (both cloned the template above them).
git's merge interleaved the two near-identical preambles into ONE conflict
region, and a mechanical keep-both resolution produced a single function with
two `let now`, two `global.window`, two stub canvases — a Frankenstein that
parses on a good day and lies on a bad one. The rule: **a conflict that
starts inside a function body is never resolved by keep-both.** Take each
worker's section WHOLE from its own branch (`git show origin/<branch>:file`,
find the function's first and last line, transplant), add its main() call and
PASS-line fragment by hand, and run the suite. Keep-both is only ever right
for conflicts between top-level, self-contained blocks (a data table appended
twice, two optional save fields). Also, and cheaper: parallel workers should
be told to REUSE the suite's existing boot helper rather than clone it, and to
name their section distinctively — identical preambles are what git trips on.

**Stale-brief hazard — the one that actually keeps biting.** A queued prompt is
a snapshot of the tree at the moment it was written, and every merge ages it.
M-WIDE took `COLS` from 80 to 112; the M-ONBOARD-2 prompt sitting in the queue
still said "centre stage", which at 112 columns means GRIT's speech box lands on
top of the CHAIN and STOCK panels, because the reflexive `(COLS - len) >> 1` is
now the *screen's* centre and not the *map's*. Nothing in the brief was wrong
when it was written and nothing in it was right when it was dispatched. The
audit after any merge that moves a global — `COLS`, a law count, a renamed API,
a panel that now owns screen space — is: grep the queue for the old value.
**This is the same failure as the four silent M-HIRES/M-CORELORE seams, one step
earlier in the pipeline:** two correct pieces of work, written against different
trees, and no single worker in a position to notice.

**Cross-brief gotcha:** M-POLISH fixed the manual's wrong constants (CX-02/03)
by making the manual *compose* its numbers from `js/data.js` at load, and
M-MANUAL later rebuilds that manual from scratch — so the M-MANUAL worker must
keep composing rather than typing numbers, at its own HEAD, never trusting the
old text or `SPEC.md` (which can itself lag `data.js`). Its prompt says so in
capitals. Same shape of hazard whenever a later brief rewrites a file an
earlier one patched: **the fix must survive the rewrite, not just the review.**

**Merge-order note for Wave 2 — superseded by events, and the lesson generalizes.**
The plan was to land M-RECAP and M-MANUAL *before* M-ANIM, on the theory that
replaying animation hooks onto new screens beats re-applying a screen rewrite
through animated draw code. Then M-ANIM finished first, alone, and the better
move was the opposite: merge it immediately and let the other two branch from a
master that already has animation. A conflict you never create beats one you
merge well. **Generally: when the shared-hot-file brief finishes first, merge it
before dispatching the rest of its wave** — that converts a three-way render.js
conflict into two sequential no-conflict merges.
