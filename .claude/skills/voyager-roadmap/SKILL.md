---
name: voyager-roadmap
description: Track implementation progress and validate design decisions for the Voyager Buddy project — transforming Voyager into a Minecraft survival co-op companion. Use this skill whenever someone asks where we are on the roadmap ("what's done?", "what's next?", "show progress"), is about to implement any component from Phase 1 or Phase 2 and wants to verify their approach, mentions any of the key architectural components (reactive layer, dual-layer architecture, pillarUp, experiences.json, survival memory, isSheltered, fight/flee logic, reset modes, shelter building approach, home concept), or asks how to implement something in the Voyager codebase. Also trigger when the user says "let's start Phase 1/2" or "I'm implementing X" — check their plan before they write code.
---

# Voyager Roadmap Tracker

You help track implementation progress and guard against deviations from agreed design decisions in the Voyager Buddy project.

The project goal: transform Voyager from a solo Minecraft LLM agent into a fully autonomous survival companion that a real player can co-op with.

Two runtimes: Python (`voyager/`) orchestrates agents; Node.js (`voyager/env/mineflayer/`) runs the Mineflayer bot as an HTTP server.

Roadmap documents live in `docs/roadmap/`. Key decisions are condensed in `references/key-decisions.md` — read this file whenever you need to validate an approach.

---

## Choose your mode

**Mode 1 — Progress Report**
Triggered by: "where are we?", "what's done?", "show roadmap status", "what should I implement next?"
→ Scan the codebase, check every item in the checklists below, and report status.

**Mode 2 — Design Validation**
Triggered by: "I'm about to implement X", "should I use approach A or B for X?", "is this the right way to implement X?"
→ Read `references/key-decisions.md`, check the plan against agreed decisions, flag any deviations clearly.

**When intent is unclear:** run both modes. A progress report is always useful context for design validation anyway.

---

## Mode 1: Progress Report

Start by reading `ROADMAP.md` for the phase overview. Then check each item below by reading files and grepping for key strings.

Mark each item:
- ✅ Done — file exists and/or key content confirmed
- 🔄 Partial — file exists but key content missing, or only partially implemented
- ⬜ Not started — file does not exist

### Phase 1 — Architectural Foundations ✅ COMPLETE

**1.1 Dual-Layer Architecture** ✅
- `voyager/env/mineflayer/lib/reactive/index.js` — exists ✅
- `voyager/env/mineflayer/lib/reactive/priorities.js` — exists ✅
- `voyager/env/mineflayer/lib/reactive/rules.js` — exists ✅
- `voyager/env/mineflayer/lib/reactive/actions.js` — exists ✅
- `voyager/env/mineflayer/index.js` — contains `recentReactiveEvents` ✅
- `voyager/env/bridge.py` `step()` — no `pause`/`unpause` calls (only in `reset()`, which is correct) ✅

**1.2 Persistent Session State** ✅
- `voyager/voyager.py` — contains `reset_mode` param and `self.reset_mode` ✅
- `voyager/env/bridge.py` — `options.get("mode", "hard")` passes reset mode to Node.js ✅
- `voyager/env/mineflayer/index.js` — `/clear @s` and `/kill @s` inside `if (req.body.reset === "hard")` ✅
- Known gap: `"none"` reset mode (no disconnect) is not yet distinct from `"soft"` at the Node.js level — deferred

**1.3 Player in Observation Space** ✅
- `voyager/env/mineflayer/lib/observation/players.js` — exists ✅
- `voyager/env/mineflayer/index.js` — `Players` in `obs.inject(...)` list ✅
- `voyager/agents/curriculum.py` — parses `nearbyPlayers` from events, renders in observation ✅
- `voyager/agents/action.py` — parses `nearbyPlayers` from events, renders in observation ✅

**1.4 Survival Mode Support** ✅
- `.env.example` — contains `GAME_MODE` ✅
- `voyager/env/mineflayer/lib/observation/status.js` — contains `isOnFire` and `isDaytime` ✅
- `voyager/prompts/curriculum.txt` — contains `Nearby players`, `On fire`, updated Health/Hunger thresholds ✅
- `voyager/prompts/action_template.txt` — contains `Nearby players`, `On fire` ✅
- `voyager/voyager.py` — contains `_propose_next_task(game_mode)` with fire/health/food threshold override ✅
- `voyager/agents/curriculum.py` — parses `isOnFire`, adds `on_fire` and `nearby_players` to observation dict ✅
- `voyager/agents/action.py` — parses `isOnFire`, renders `On fire` and `Nearby players` in observation ✅

### Phase 2 — Survival Core

**2.1 Food Management**
- `voyager/env/mineflayer/lib/reactive/rules.js` — contains hunger threshold / auto-eat logic?

**2.2 Hostile Mob Handling + Pillar**
- `voyager/control_primitives/pillarUp.js` — exists?
- `voyager/control_primitives_context/pillarUp.js` — exists?
- `voyager/env/mineflayer/lib/reactive/rules.js` — contains fight/flee mob logic?
- `voyager/env/mineflayer/lib/reactive/actions.js` — contains `pillarUp` call or `fleeFromMobs`?

**2.3 Shelter Building + Experience Memory**
- `voyager/agents/survival_memory.py` — exists?
- `voyager/prompts/curriculum.txt` — building restriction removed? (should NOT contain the phrase "placing, building, planting, and trading tasks should be avoided") ✅ already removed in Phase 1.4
- `voyager/prompts/curriculum.txt` — contains survival experiences section? (grep for `survival` or `experiences`)

**2.4 Basic Chat Commands**
- `voyager/env/mineflayer/lib/chat.js` — exists?
- `voyager/env/mineflayer/index.js` — contains `recentChatCommands`?

**2.5 Day/Night Cycle + Home**
- `voyager/env/mineflayer/lib/observation/shelter.js` — exists?
- `ckpt/survival/home.json` or a creation path for it in Python — exists?

**2.6 Death Handling**
- `voyager/env/mineflayer/index.js` — contains `bot.on('death')`?
- `voyager/agents/survival_memory.py` — contains `record_event`?

### Report output format

Present a table per phase with item and status. Then:

```
Phase 1: COMPLETE (all items done, one known gap: "none" reset mode not distinct from "soft" at Node.js level)
Phase 2: X/16 items complete

Next recommended item: [specific file/feature to implement next, based on the implementation order in the phase docs]
```

---

## Mode 2: Design Validation

Read `references/key-decisions.md` before responding to any "how should I implement X" question.

Also read the relevant phase doc if the user is working on something specific:
- Phase 1 decisions → `docs/roadmap/phase-1-architectural-foundations.md`
- Phase 2 decisions → `docs/roadmap/phase-2-survival-core.md`

### How to validate

1. Identify what the user is proposing
2. Find the matching decision in `references/key-decisions.md`
3. Check for deviations

If the plan **matches** the agreed decision: confirm it clearly and point to the relevant file change summary in the phase doc.

If the plan **deviates** from the agreed decision: be direct. State:
- What was agreed and why
- What specifically differs in their plan
- What to do instead

Don't be vague. "That might work but..." is not useful. Say clearly "This deviates from the agreed approach because X. The correct approach is Y."

### High-risk deviations to watch for

These are the decisions most likely to be second-guessed during implementation:

**Shelter building**: If the user proposes writing a hardcoded `buildSimpleShelter` primitive — flag this. The agreed decision is Approach A: LLM generates shelter code. `pillarUp` is the emergency fallback, not a shelter substitute.

**Reactive/strategic split**: If the user proposes rewriting the eval-based skill execution to a goal-based API in Phase 1 — flag this. Approach B keeps eval-based execution and adds a parallel reactive layer. Goal-based is the long-term migration target (Phase 3+), not Phase 1.

**Python/Node communication**: If the user proposes adding a WebSocket, a `/status` polling endpoint, or any mechanism for Python to be notified of reactive events in real time — flag this. Variant C: Node.js reacts autonomously, Python reads `recentReactiveEvents` from the next `/step` response.

**Fight/flee**: If the user proposes random movement as the flee direction — flag this. The flee pattern is: sprint away from mob cluster centroid → `pillarUp` if still pursued. If home is within 50 blocks: sprint toward home.

**Player inventory**: If the user proposes implementing a companion mod to access player inventory — note that this is explicitly deferred. Phase 1-2 use only Mineflayer-visible data (Variant A).

---

## Guidance on implementation order within phases

Phase 1: **COMPLETE.** All four blockers implemented across branches leading to `buddy/phase1`.

Phase 2 order: food reactive rules → fight/flee + pillarUp → survival_memory.py + experiences checkpoint → chat.js → shelter observation (isSheltered) + home.json → death handler.

If the user asks "what should I implement first?", give the specific next uncompleted item from the relevant phase checklist, not a general answer.
