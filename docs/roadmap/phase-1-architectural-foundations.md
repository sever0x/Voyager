# Phase 1 — Architectural Foundations: Technical Design

## Overview

This document details the technical decisions behind Phase 1 of the Voyager Buddy roadmap. Phase 1 removes the four architectural blockers that make survival co-op impossible in the current system. No gameplay features are built here — only the structural changes that make them buildable.

The four blockers in implementation order:

1. Dual-layer reactive/strategic architecture
2. Persistent session state
3. Player presence in observation space
4. Survival mode support

---

## Blocker 1 — Dual-Layer Architecture

### Why the current architecture breaks in survival

The current execution model is synchronous and pauses Minecraft between every LLM call:

```
Python                    Node.js                  Minecraft
  │                          │                          │
  ├── POST /step (JS code) ──►│                          │
  │                          ├── eval(code) ────────────►│
  │                          │   (game paused)           │
  │◄── observations ─────────┤◄── result ───────────────┤
  │   (~1-3s later)          │                          │
```

A creeper explodes in 1.5 seconds. A lava pool kills in 2 seconds. The bot cannot react to either because Python is waiting on an LLM response.

### Target architecture

Two independent layers running in parallel:

```
Python (strategic, async)              Node.js (always running)
─────────────────────────              ──────────────────────────────────────
CurriculumAgent                        Reactive Rules Engine
ActionAgent          ─── goal ──────►  ├── Priority 0: event listeners (immediate)
CriticAgent                            ├── Priority 1-3: polling loop (200-2000ms)
SkillManager         ◄── result ───── └── Goal Executor (runs current strategic goal)
                     ◄── interrupt ──     (reports reactive interrupts in next response)
```

Python does not react to individual combat frames or hunger ticks — that is Node.js's job. Python receives the outcome of what Node.js did and plans the next strategic goal.

### Approach: parallel reactive layer over existing eval-based execution (Approach B)

The existing skill execution model (Python generates JS → Node.js `eval()`s it) is preserved. A new reactive rules engine is added to Node.js as a parallel system. Skills are progressively made interrupt-aware.

This is chosen over a full goal-based API rewrite (Approach A) because:
- Approach A requires rewriting the Node.js executor, all agents, and all skills simultaneously — too large a single change
- Approach B can be introduced incrementally: reactive layer first, then migrate skills one by one
- The migration path to Approach A remains open (see end of this section)

### Priority taxonomy

Five priority levels govern reactive behavior. Higher priority overrides lower.

| Level | Name | Trigger conditions | Interruption type | Polling interval |
|---|---|---|---|---|
| 0 | CRITICAL | On fire, in lava, in void | Immediate (event-driven) | — |
| 1 | HIGH | Health ≤ 3 hearts, drowning | Soft (abort at next yield) | 200 ms |
| 2 | MEDIUM | Hunger ≤ 4, hostile mob ≤ 6 blocks | Transactional (finish current action) | 500 ms |
| 3 | LOW | Hunger ≤ 8, hostile mob ≤ 15 blocks | Inform only (no interruption) | 2000 ms |
| 4 | STRATEGIC | All other decisions | Normal LLM cycle | — |

**Priority 0 is event-driven, not polled.** Mineflayer fires `bot.on('onFire')` and `bot.on('entityHurt')` in the same event loop as the eval'd skill code. These listeners run without waiting for the polling interval.

**Priority 0 interruption mechanics.** A hard interrupt without worker threads is achieved by:
1. Calling `bot.pathfinder.setGoal(null)` — stops all movement immediately
2. Setting a shared `abortFlag.current = 'CRITICAL'`
3. Executing the emergency behavior directly in the event listener (move to water, step away from lava)
4. The running skill code will either complete its current microtask and check the flag, or throw — either outcome is acceptable

**Soft interrupt (Priority 1) mechanics.** Skill code is instrumented with periodic abort-flag checks inside loops:

```js
// Example: mineBlock instrumented for soft interrupt
for (let i = 0; i < targets.length; i++) {
    checkAbort(abortFlag); // throws AbortError if flag is set
    await bot.collectBlock.collect(targets[i], { ignoreNoPath: true });
}
```

`checkAbort` throws a named `AbortError`. The skill's top-level try/catch catches it, emits a `bot.save('task_aborted')` event, and resolves the step promise with an aborted status.

**Transactional interrupt (Priority 2) mechanics.** No instrumentation required. The polling loop waits for the current `await` to resolve naturally, then sets the abort flag before the next iteration begins. The skill completes its current atomic operation (one `mineBlock` call, one `craftItem` call) and does not start the next.

### Reactive rules engine: file structure

New module added to `voyager/env/mineflayer/lib/`:

```
lib/
└── reactive/
    ├── index.js       ← engine entry point, attaches to bot, starts polling
    ├── priorities.js  ← priority level constants and AbortError definition
    ├── rules.js       ← individual rule definitions (one function per rule)
    └── actions.js     ← emergency action implementations (flee, eat, attack)
```

`index.js` is initialized in `mineflayer/index.js` after `bot.once('spawn', ...)` and before the step loop begins.

### Communication: how Python learns about reactive interruptions

Python is **not notified in real time**. The reactive layer acts autonomously. Python discovers what happened from the `observations` object returned in the next `/step` response.

A new field `recentReactiveEvents` is added to the observation JSON:

```json
{
  "recentReactiveEvents": [
    {
      "priority": 0,
      "trigger": "onFire",
      "action": "move_to_water",
      "timestamp": 1234567890,
      "outcome": "resolved"
    }
  ]
}
```

This field is an append-only log cleared at the start of each `/step` call. Python's ActionAgent and CurriculumAgent parse it when building the next prompt. If the list is non-empty, the current task is treated as interrupted and is re-evaluated before proposing the next action.

### Migration path to goal-based API (Approach A)

The reactive layer introduced in Phase 1 is the foundation for Approach A. Migration happens gradually:

1. **Phase 1** — Reactive layer added; skills still eval'd as-is
2. **Phase 2–3** — New skills written as declarative goal objects instead of imperative JS; Node.js goal executor grows to handle them
3. **Phase 4–5** — Python sends high-level intent objects; Node.js translates them to goals; eval-based execution used only as fallback for skills not yet migrated
4. **Long term** — eval-based path removed; all skills are goal-driven

No single large refactor is required. Each phase adds more goal-native skills while eval-based skills continue to work.

---

## Blocker 2 — Persistent Session State

### Current behavior

`env.reset("hard")` sends `/clear @s` and `/kill @s` via bot chat on every task transition. This is incompatible with survival: it destroys accumulated inventory progress.

`env.reset("soft")` disconnects and reconnects the bot. This is safe to keep for error recovery.

### New reset mode semantics

A `reset_mode` parameter replaces the current `"hard"` / `"soft"` binary:

| Mode | Behavior | When to use |
|---|---|---|
| `"none"` | Bot continues from current state, no disconnect | Normal task transitions in survival |
| `"soft"` | Bot disconnects and reconnects; inventory preserved | Error recovery, stuck pathfinder |
| `"hard"` | Full inventory clear + kill + reconnect | Testing, fresh session setup only |

The default mode for survival sessions is `"none"`.

### Changes required

**`voyager/env/mineflayer/index.js` — `/start` endpoint:**
- Add `reset_mode` to request body (default: `"soft"` for backward compatibility)
- `/clear @s` and `/kill @s` only execute when `reset_mode === "hard"`

**`voyager/env/bridge.py` — `VoyagerEnv.reset()`:**
- Accept `reset_mode` parameter
- Pass it through to the `/start` HTTP call
- Remove the hardcoded `"hard"` reset call from the `learn()` loop preamble

**`voyager/voyager.py` — `learn()` method:**
- Remove the one-time hard reset at session start (or make it conditional on `fresh_start=True`)
- Between task iterations: call `env.reset(mode="none")`

### Death handling (deferred to Phase 2)

After bot death, items drop at the death location. Inventory recovery logic (navigate back, collect drops) is a Phase 2 feature. Phase 1 only ensures the system does not actively destroy inventory on task transitions.

---

## Blocker 3 — Player Presence in Observation Space

### What Mineflayer can observe about other players

Mineflayer tracks connected players via `bot.players`. Each entry exposes:
- Entity position (updated via entity tracking packets)
- Entity health (visible in entity metadata)
- Equipped items: helmet, chestplate, leggings, boots, main hand, off hand
- Username and ping

**What is not accessible:** the player's full inventory. This is consistent with real Minecraft — a player cannot see another player's inventory without mods. Accepted as a hard limitation.

### New observation module

New file: `voyager/env/mineflayer/lib/observation/players.js`

Follows the existing observation module pattern (see `status.js`, `inventory.js`).

Emits a `nearbyPlayers` array on each observation event:

```json
{
  "nearbyPlayers": [
    {
      "username": "Steve",
      "position": { "x": 12, "y": 64, "z": -8 },
      "distance": 14.2,
      "health": 16,
      "equipment": {
        "head": "iron_helmet",
        "chest": "iron_chestplate",
        "legs": null,
        "feet": "iron_boots",
        "mainhand": "diamond_pickaxe",
        "offhand": null
      }
    }
  ]
}
```

Players beyond 64 blocks are excluded. The array is sorted nearest-first.

### Integration in Python agents

`nearbyPlayers` is parsed in `voyager/agents/action_agent.py` and `voyager/agents/curriculum_agent.py` alongside the existing observation fields. It is injected into prompts in the same format as `Nearby entities`.

Phase 5 (cooperative logic) will use this data for follow behavior, player protection, and resource sharing. In Phase 1, it is observation-only — agents are aware the player exists but do not yet act on that awareness.

---

## Blocker 4 — Survival Mode Support

### Why prompts and agents need changes

All four agents currently treat health and hunger as neutral stats. A bot at 2 hearts with no food will still be proposed "Mine 5 iron ore" as the next task. The observation fields exist (`bot.health`, `bot.food`) but are not acted upon with appropriate urgency.

### Survival override layer (Python)

A survival override is added as a pre-filter in `VoyagerEnv` or `Voyager.learn()` before `CurriculumAgent.propose_next_task()` is called. It checks survival thresholds and injects mandatory tasks:

```
if health < 6 (3 hearts):
    → override next task: "Heal or find safety"
elif food < 6:
    → override next task: "Eat food or find food source"
elif hostile mob in nearbyEntities and no weapon equipped:
    → override next task: "Equip weapon or flee"
else:
    → proceed to CurriculumAgent normally
```

This layer is deterministic and does not require an LLM call. It ensures the bot never ignores a critical survival state regardless of what the LLM would otherwise suggest.

### Observation additions

`voyager/env/mineflayer/lib/observation/status.js` already exposes `bot.health` and `bot.food`. Add:
- `bot.oxygenLevel` (drowning state)
- `bot.isOnFire` (fire state, boolean)
- `timeOfDay` is already present; add `isDaytime` boolean derived from it

### Prompt changes

All agent prompt templates (`action_template.txt`, `curriculum.txt`, `critic.txt`) receive a new `Survival status` section:

```
Health: {health}/20 ({hearts} hearts). Below 6 is dangerous.
Hunger: {food}/20. Below 6 requires immediate eating.
On fire: {isOnFire}
Time: {timeOfDay} ({isDaytime})
```

CurriculumAgent prompt criteria gain a new rule:

> If health is below 6 or hunger is below 6, the next task must address survival before any exploration or crafting goal.

### Configuration

New environment variable in `.env` / `.env.example`:

```
GAME_MODE=survival   # "survival" | "creative" (default: "creative" for backward compatibility)
```

When `GAME_MODE=creative`:
- Survival override layer is disabled
- Survival stats are still observed but not acted upon
- Behavior is identical to current Voyager

When `GAME_MODE=survival`:
- Survival override layer is active
- Hard reset is disabled by default (`reset_mode=none`)
- CurriculumAgent warm-up thresholds for survival stats are set to 0 (always visible)

---

## File Change Summary

| Status | File | Change |
|---|---|---|
| ✅ Done | `voyager/env/mineflayer/lib/reactive/index.js` | New — reactive engine entry point |
| ✅ Done | `voyager/env/mineflayer/lib/reactive/priorities.js` | New — priority constants, AbortError |
| ✅ Done | `voyager/env/mineflayer/lib/reactive/rules.js` | New — rule definitions |
| ✅ Done | `voyager/env/mineflayer/lib/reactive/actions.js` | New — emergency action implementations |
| ✅ Done | `voyager/env/mineflayer/lib/observation/reactive_events.js` | New — recentReactiveEvents observation module (not in original plan, added during implementation) |
| ✅ Done | `voyager/env/mineflayer/index.js` | Modified — initialize reactive engine, add recentReactiveEvents to observations, clear events at /step start |
| ✅ Done | `voyager/env/bridge.py` | pause/unpause removed from step() hot path; reset_mode flows through existing options dict |
| ✅ Done | `voyager/voyager.py` | reset_mode param added to __init__; learn() uses it for initial and error-recovery resets |
| ⬜ Not started | `voyager/env/mineflayer/lib/observation/players.js` | New — nearbyPlayers observation module |
| ⬜ Not started | `voyager/voyager.py` | Modified — remove forced hard reset from learn(), add survival override call |
| ⬜ Not started | `voyager/agents/curriculum_agent.py` | Modified — parse nearbyPlayers, add survival override integration |
| ⬜ Not started | `voyager/agents/action_agent.py` | Modified — parse nearbyPlayers and survival stats |
| ⬜ Not started | `voyager/prompts/curriculum.txt` | Modified — add survival status section and survival rule |
| ⬜ Not started | `voyager/prompts/action_template.txt` | Modified — add survival status section |
| ⬜ Not started | `voyager/prompts/critic.txt` | Modified — add survival state to success evaluation criteria |
| ⬜ Not started | `voyager/control_primitives/mineBlock.js` | Modified — add abort flag check in loop |
| ⬜ Not started | `.env.example` | Modified — add GAME_MODE variable |

## Implementation Notes

Decisions made during implementation that deviate from or extend the original design:

**Fire detection — block-based instead of entity metadata.** The original design referenced `bot.on('onFire')` and entity metadata bit 0. In practice, Mineflayer's `entity.metadata` format is ambiguous across versions. The implemented approach checks `bot.blockAt(pos)` for `fire` / `soul_fire` block names, which is reliable in all versions and detects the hazard before damage occurs.

**Priority 0 mechanism — `physicsTick` + `entityHurt` hybrid.** The design specified purely event-driven Priority 0 via `bot.on('entityHurt')`. In testing, `entityHurt` does not fire in Creative mode (no damage), making it unsuitable as the sole trigger. The implementation uses `physicsTick` (corrected spelling from deprecated `physicTick`) for position-based detection (works in all game modes) and adds `entityHurt` as a supplement for Survival mode.

**`escapeFromHazard` action.** The original design scoped Priority 0 actions to "move to water, step away from lava" without a concrete implementation. The implemented `escapeFromHazard` uses direct control states (sprint + jump) rather than pathfinder navigation, which is more reliable when the bot is actively taking damage and pathfinder may be slow or confused.

**`reset_mode` in bridge.py — partially done.** The `pause`/`unpause` calls were removed from `step()` (game no longer freezes between LLM calls). The `reset_mode` parameter itself (passing `"none"` / `"soft"` / `"hard"` from Python to Node.js) is not yet implemented — this is the remaining item for Blocker 2.
