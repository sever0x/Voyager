# Phase 1 — Architectural Foundations

**Status: ✅ Complete**  
**Branch:** `buddy/phase1`

Phase 1 does not add gameplay features. It removes four structural blockers that made the original Voyager incompatible with Survival co-op. Without these changes, none of the Phase 2+ features are buildable on a reliable foundation.

---

## The Four Blockers

### Blocker 1 — The game paused between every LLM call

**Problem:** The original code called `env.pause()` before sending code to the bot and `env.unpause()` after receiving the result. This literally froze Minecraft while Python waited for the LLM response (1–10 seconds). In Survival mode, a creeper explodes in 1.5 seconds. The bot would be dead before it could react.

**Solution: Dual-layer reactive/strategic architecture.**

A new reactive rules engine was added to Node.js that runs permanently and independently of Python:

```
lib/reactive/
├── index.js      — engine entry point, attaches to bot, starts polling loops
├── priorities.js — priority level constants (CRITICAL/HIGH/MEDIUM/LOW/STRATEGIC)
├── rules.js      — individual rule definitions (one function per rule)
└── actions.js    — emergency action implementations (flee, escape hazard)
```

The engine uses five priority levels:

| Level | Name | Trigger | Response time |
|---|---|---|---|
| 0 | CRITICAL | On fire, in lava, in void | Immediate (event-driven) |
| 1 | HIGH | Health ≤ 3 hearts, drowning | 200ms polling |
| 2 | MEDIUM | Hunger ≤ 4, hostile mob ≤ 6 blocks | 500ms polling |
| 3 | LOW | Hunger ≤ 8, mob ≤ 15 blocks | 2000ms polling |
| 4 | STRATEGIC | Everything else | LLM cycle |

Priority 0 is event-driven (fires immediately via `bot.on('entityHurt')` and `physicsTick`), not polled. It does not wait for Python.

Python learns what the reactive layer did via `recentReactiveEvents` — a field included in every `/step` response, cleared at the start of each step.

`pause`/`unpause` were removed from `bridge.py::step()`. They remain only in `reset()`, where they bracket the Mineflayer subprocess restart — which is correct behavior.

**Files changed:**
- `voyager/env/mineflayer/lib/reactive/index.js` — new
- `voyager/env/mineflayer/lib/reactive/priorities.js` — new
- `voyager/env/mineflayer/lib/reactive/rules.js` — new
- `voyager/env/mineflayer/lib/reactive/actions.js` — new
- `voyager/env/mineflayer/lib/observation/reactive_events.js` — new
- `voyager/env/mineflayer/index.js` — modified (reactive engine init, `recentReactiveEvents` cleared each step)
- `voyager/env/bridge.py` — modified (pause/unpause removed from `step()`)

**Implementation notes:**

*Fire detection* uses `physicsTick` + block position checks (`bot.blockAt(pos)` for `fire`/`soul_fire` block names) rather than entity metadata bit 0. This is reliable across all Minecraft versions and detects the hazard before damage occurs. The `bot.on('entityHurt')` event is added as a supplement but is not the primary trigger (it does not fire in Creative mode).

*`escapeFromHazard` action* uses direct control states (sprint + jump) rather than pathfinder navigation. Pathfinder is too slow to initialize when the bot is actively taking damage.

---

### Blocker 2 — Inventory was destroyed between every task

**Problem:** `env.reset()` sent `/clear @s` and `/kill @s` via bot chat on every task transition. In Creative mode this is harmless — the bot had nothing to lose. In Survival, it destroyed accumulated inventory progress. Hours of gathering, wiped after every single task.

**Solution: `reset_mode` parameter.**

Three modes now exist:

| Mode | Behavior | Use case |
|---|---|---|
| `"hard"` | `/clear @s` + `/kill @s` + reconnect | Creative testing, fresh session |
| `"soft"` | Disconnect + reconnect; inventory intact | Error recovery |
| `"none"` | Continue from current state (planned) | Normal survival task transitions |

`reset_mode` is a parameter of `Voyager.__init__()`, stored as `self.reset_mode`, and passed to `bridge.py` as `options={"mode": self.reset_mode}`. Bridge passes it to Node.js as `req.body.reset`. Node.js only runs `/clear @s` and `/kill @s` when `req.body.reset === "hard"`.

**Known gap:** The `"none"` mode (no disconnect at all) is not yet distinct from `"soft"` at the Node.js level — both result in bot reconnect. The difference requires a separate code path in `bridge.py::reset()` that skips `mineflayer.stop()`. Deferred — `"soft"` is sufficient for Phase 2.

**Files changed:**
- `voyager/voyager.py` — `reset_mode` param added to `__init__()`, used in `learn()` and `inference()`
- `voyager/env/bridge.py` — `options.get("mode", "hard")` passes mode to Node.js
- `voyager/env/mineflayer/index.js` — `/clear @s` and `/kill @s` wrapped in `if (req.body.reset === "hard")`

---

### Blocker 3 — The bot had no knowledge that a player existed

**Problem:** `bot.players` (Mineflayer's built-in player tracking) was never read. The bot's observation space contained only mobs (`status.entities`), and even those filtered out players explicitly:

```js
// status.js — original getEntities()
if (entity.name === "player" || entity.name === "item") continue;
```

The bot was functionally blind to the human standing next to it.

**Solution: `players.js` observation module.**

New file `voyager/env/mineflayer/lib/observation/players.js` follows the same pattern as all other observation modules (`status.js`, `inventory.js`, etc.). It iterates `bot.players`, skips the bot itself, skips players whose `entity` is `null` (out of Mineflayer's entity tracking range, typically ~128 blocks), and returns:

```json
"nearbyPlayers": [
  {
    "username": "Steve",
    "distance": 14.2,
    "position": { "x": 100.0, "y": 64.0, "z": -8.0 }
  }
]
```

The module was added to `obs.inject(bot, [...])` in `index.js`. Both `curriculum.py` and `action.py` parse `nearbyPlayers` from the observation and include it in the human message sent to the LLM.

In Phase 1, this is observation-only — agents see the player but do not yet act on that awareness. Phase 5 builds cooperative behavior on top of this foundation.

**Files changed:**
- `voyager/env/mineflayer/lib/observation/players.js` — new
- `voyager/env/mineflayer/index.js` — `Players` added to `obs.inject()` list
- `voyager/agents/curriculum.py` — parses `nearbyPlayers`, adds `nearby_players` to observation dict
- `voyager/agents/action.py` — parses `nearbyPlayers`, renders "Nearby players" line in observation

---

### Blocker 4 — No concept of Survival mode existed

**Problem:** The entire system — prompts, agents, observation parsing, curriculum rules — was written assuming Creative + Peaceful. Health and hunger appeared in observations but had no urgency attached. The curriculum prompt rule 8 explicitly banned all building tasks (`"placing, building, planting, and trading tasks should be avoided"`). A bot following this rule cannot build a shelter.

**Solution: Four changes working together.**

**a) New observation fields (`status.js`):**

```js
isOnFire: this.bot.entity.onFire || false,
isDaytime: this.bot.time.timeOfDay < 13000,
```

Both fields are now included in every `/step` response. `isOnFire` uses Mineflayer's entity metadata. `isDaytime` is derived from `bot.time.timeOfDay` (day ends at 13000 ticks).

**b) Updated prompts (`curriculum.txt`, `action_template.txt`):**

Added to both prompts:
- `Nearby players (nearest to farthest): ...`
- `On fire: true/false`

Updated Health and Hunger descriptions to include urgency thresholds:
- `Health: Higher than 15 means I'm healthy. Below 6 is dangerous.`
- `Hunger: Higher than 15 means I'm not hungry. Below 6 requires immediate eating.`

Replaced the old rules 7–8 with survival-aware versions:
- Rule 7: If health or hunger < 6, the next task must address survival before anything else
- Rule 8: If on fire, the next task must be to find water
- Rule 9: Softened building restriction — building tasks are now allowed when they can be verified from inventory/entity state

**c) Agent observation parsing (`curriculum.py`, `action.py`):**

Both agents now parse `isOnFire` and `nearbyPlayers` from events. The curriculum agent adds `on_fire` and `nearby_players` as named keys in its `observation` dict (subject to the same `warm_up` gating as other fields, both with threshold 0 — always shown).

**d) Deterministic survival override (`voyager.py`):**

New method `_propose_next_task(game_mode)` is called instead of `curriculum_agent.propose_next_task()` directly when `GAME_MODE=survival`:

```
On fire?       → "Find water to extinguish the fire"
health < 6?    → "Eat food or find safety to restore health"  
food < 6?      → "Find and eat food immediately"
otherwise      → CurriculumAgent.propose_next_task()
```

This layer is deterministic, requires no LLM call, and fires before the curriculum agent gets a chance to suggest something irrelevant. Controlled by `GAME_MODE=creative|survival` in `.env`.

**Files changed:**
- `.env.example` — `GAME_MODE=creative` added
- `voyager/env/mineflayer/lib/observation/status.js` — `isOnFire`, `isDaytime` added
- `voyager/prompts/curriculum.txt` — new fields, rules 7–9 rewritten
- `voyager/prompts/action_template.txt` — new fields added
- `voyager/agents/curriculum.py` — `isOnFire`, `nearbyPlayers` parsed; `on_fire`, `nearby_players` added to observation dict and warmup/observations lists
- `voyager/agents/action.py` — `isOnFire`, `nearbyPlayers` parsed and rendered
- `voyager/voyager.py` — `_propose_next_task()` method added, `learn()` uses it

---

## Phase 1 Milestone

> The bot runs in Survival mode without crashing, without clearing its inventory between tasks, and with awareness of nearby players. It reacts to fire, lava, and critical health states without waiting for an LLM call. When `GAME_MODE=survival`, a deterministic layer ensures survival tasks are always prioritized over exploration when the bot's state is critical.

---

## What Phase 1 Does Not Include

- Food auto-eating (Phase 2.1) — the reactive layer has the priority structure but the hunger rule is not yet wired to an eat action
- `pillarUp` primitive (Phase 2.2)
- `survival_memory.py` and experience checkpointing (Phase 2.3)
- Chat command parsing (Phase 2.4)
- Shelter detection and home tracking (Phase 2.5)
- Death handling and item recovery (Phase 2.6)
- Player health observation — `bot.players[username].entity.metadata` exposes health but it was not added in Phase 1; deferred to Phase 3 when player protection logic needs it
