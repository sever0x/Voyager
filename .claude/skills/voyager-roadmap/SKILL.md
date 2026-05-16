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

**2.1 Food Management** ✅
- `voyager/env/mineflayer/lib/reactive/rules.js` — contains `checkHunger()` with `hunger_critical` (≤4) and `hunger_low` (≤8) thresholds ✅
- `voyager/env/mineflayer/lib/reactive/actions.js` — contains `eatBestFood()` with `FOOD_PRIORITY` list (cooked > raw, saturation-first) and `noFood` event emission ✅
- `voyager/env/mineflayer/lib/reactive/index.js` — `eatInProgress` flag, wired to p2 (500ms) and p3 (2000ms) intervals ✅
- `voyager/env/mineflayer/index.js` — survival game_mode gating: no `keepInventory`, no `doDaylightCycle false`, no `returnItems()` ✅
- `voyager/control_primitives/givePlacedItemBack.js` — early return in survival mode ✅
- `voyager/env/bridge.py` — passes `game_mode` to Node.js in reset payload ✅
- `voyager/voyager.py` — `_get_food_task()` with 4-level hierarchy (smelt raw meat → hunt animal → craft bread → explore); `_propose_next_task` uses consolidated `food_emergency` check ✅
- `voyager/agents/curriculum.py` — `_FOOD_ITEMS` constant; `food_items` observation field extracted before warm-up filter; `"food_items"` in `curriculum_observations` and `default_warmup` ✅
- `voyager/prompts/curriculum.txt` — `Food in inventory:` field between Hunger and On fire; rule 7 updated with decision tree ✅

**2.2 Hostile Mob Handling + Pillar** ✅
- `voyager/control_primitives/pillarUp.js` — exists ✅
- `voyager/control_primitives_context/pillarUp.js` — exists ✅
- `voyager/env/mineflayer/lib/reactive/rules.js` — contains `HOSTILE_MOBS` set, `checkHostileMobs()`, `decideFightOrFlee()`, `hasWeapon()` ✅
- `voyager/env/mineflayer/lib/reactive/actions.js` — contains `fleeFromMobs`, `fightMob`, `tryEquipWeapon`, `pillarUpReactive` ✅
- `voyager/env/mineflayer/lib/reactive/index.js` — `fleeInProgress` and `fightInProgress` flags; mob check at 6 blocks (p2) and 15 blocks (p3) ✅
- `voyager/prompts/curriculum.txt` — rule 10: craft weapon before evening if none in inventory ✅

Key implementation notes for future validation:
- `hasWeapon(bot)` checks hand AND full inventory (dual method: `findInventoryItem` + `items().find()`)
- Spider threshold is `>= 1` (always flee from any spider, not just 2+)
- Flee loop re-asserts `pathfinder.setGoal(null)` every 5 ticks to prevent LLM pathfinder override; jumps every 5 ticks to navigate terrain obstacles
- `pillarUpReactive` uses try-catch around all pathfinder calls; default height 3 (not 4) for speed (~1s vs 1.8s)
- `fightMob` has 15s hard timeout + `pvp.stop()` to prevent infinite hang
- Fight branch also awaits `tryEquipWeapon` before `pvp.attack` if no weapon in hand

**2.3 Shelter Building + Experience Memory** ✅
- `voyager/agents/survival_memory.py` — exists, contains `SurvivalMemory`, `record_event`, `get_recent_lessons` ✅
- `voyager/env/mineflayer/lib/observation/shelter.js` — exists, exports `checkSheltered(bot)` → `{isSheltered, safeToRecordLesson}` ✅
- `voyager/env/mineflayer/lib/observation/status.js` — imports `checkSheltered`, returns `isSheltered` in observe() ✅
- `voyager/env/mineflayer/lib/reactive/rules.js` — exports `HOSTILE_MOBS` ✅
- `voyager/env/mineflayer/index.js` — contains `bot.on('death')`, `bot.on('entityHurt')`, `bot._isBeingReset`, `bot.lastDamagingEntity` ✅
- `voyager/voyager.py` — contains `SurvivalMemory` import, `self.survival_memory`, `_process_survival_events`, `_get_shelter_task` ✅
- `voyager/agents/curriculum.py` — `propose_next_task` accepts `survival_lessons`, `render_human_message` accepts `survival_lessons`, `render_observation` contains `is_sheltered`, `curriculum_observations` includes `"shelter"` ✅
- `voyager/prompts/curriculum.txt` — contains rules 11 and 12, contains `Sheltered:` and `Recent survival experiences` fields ✅
- `run.py` — reads `RESUME` and `RESET_MODE` from env ✅
- `ckpt/survival/experiences.json` — created on first death/damage event ✅

Key implementation notes:
- `isSheltered` check: solid above (Y+2) + ≥3 solid walls (Y+1) + `emittedLight > 0` in 5×5×5 cube. Doors always counted as solid (all types).
- Death attribution: `bot.lastDamagingEntity` cache updated on `entityHurt`, read in `bot.on('death')` with 3-second window.
- Damage threshold: > 4 HP (2 hearts) per entityHurt event.
- Night override fires at `noon`/`sunset` only — at night, `pillarUp` from reactive layer is the fallback.
- Loop prevention: `_get_shelter_task` not re-proposed if `self.task` already contains shelter keywords.
- Deduplication: `record_event` skips if last entry has identical type+cause.
- `RESUME=true` in `.env` → loads experiences.json and vectordbs; do NOT run with `RESUME=false` if vectordb exists.

**2.4 Basic Chat Commands** ⬜
- `voyager/env/mineflayer/lib/chat.js` — exists?
- `voyager/env/mineflayer/index.js` — contains `recentChatCommands`?

**2.5 Day/Night Cycle + Home** 🔄
- `voyager/voyager.py` — `_propose_next_task` checks `noon`/`sunset` + `isSheltered` ✅ (partial)
- `ckpt/survival/home.json` or a creation path for it in Python — not yet implemented ⬜

**2.6 Death Handling** 🔄
- `voyager/env/mineflayer/index.js` — contains `bot.on('death')` ✅
- `voyager/agents/survival_memory.py` — contains `record_event` ✅
- Item recovery logic (return to death coordinates) — not yet implemented ⬜

### Report output format

Present a table per phase with item and status. Then:

```
Phase 1: COMPLETE (all items done, one known gap: "none" reset mode not distinct from "soft" at Node.js level)
Phase 2: 1/6 features complete

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

Phase 2 order: ~~food reactive rules~~ ✅ → ~~fight/flee + pillarUp~~ ✅ → ~~survival_memory.py + isSheltered + experiences checkpoint~~ ✅ → **chat.js + recentChatCommands** (next) → home.json + item recovery after death.

If the user asks "what should I implement first?", give the specific next uncompleted item from the relevant phase checklist, not a general answer.
