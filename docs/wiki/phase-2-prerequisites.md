# Phase 2 — Prerequisites: Gating Training Commands by GAME_MODE

**Status: ✅ Complete**  
**Branch:** `buddy/phase1` (committed as Phase 2 groundwork)

This is not a gameplay feature. It is a structural fix that must land before any Phase 2 feature can work correctly. Without it, four out of six Phase 2 features are either broken or meaningless.

---

## What Was Wrong

The original Voyager was designed for a controlled **Creative + Peaceful** training loop. Every time the bot connected to Minecraft, it ran a set of admin commands to set up a predictable training environment:

```js
// index.js — on every bot spawn
bot.chat("/gamerule keepInventory true");
bot.chat("/gamerule doDaylightCycle false");
```

And after every code step:

```js
// index.js — returnItems(), called after every /step
bot.chat("/gamerule doTileDrops false");
// teleport crafting table and furnace back to bot inventory via /setblock + /give
bot.chat("/gamerule doTileDrops true");
```

And at the start of every task via Python:

```python
# voyager.py — reset(), called per task
events = self.env.step(
    "bot.chat(`/time set ${getNextTime()}`);\n"
    + f"bot.chat('/difficulty {difficulty}');"
)
```

These commands exist for valid reasons in the training context:

| Command | Why it existed in training mode |
|---|---|
| `keepInventory true` | Bot was killed with `/kill @s` every reset — without this, it lost everything on each task cycle |
| `doDaylightCycle false` | Time of day didn't matter in Creative; freezing it simplified the environment |
| `returnItems()` | After each task, placed crafting tables and furnaces were teleported back to inventory to keep a "clean" starting state |
| `/time set ${getNextTime()}` | Artificially rotated time to train the bot under different lighting conditions |
| `/difficulty peaceful/easy` | Kept hostile mobs away so the training loop wasn't disrupted |

In a survival co-op session with a human player, all of these are harmful:

| Command | What it breaks |
|---|---|
| `keepInventory true` | Phase 2 Feature 6 (death handling) is based on items dropping on death and the bot recovering them. With keepInventory, items never drop — the entire recovery logic is dead. Also removes item loss for the human player. |
| `doDaylightCycle false` | Phase 2 Feature 5 (day/night cycle awareness) gates CurriculumAgent behavior by `timeOfDay`. With the cycle frozen, `timeOfDay` never changes — the bot never receives the "nightfall approaching" signal. |
| `returnItems()` | Survival structures are progress. A placed crafting table or furnace should stay in the world. `returnItems()` teleports them back to inventory after every step — no structure ever persists. |
| `/time set` | Interferes with the natural day/night flow that Feature 5 depends on. |
| `/difficulty peaceful` | Removes all hostile mobs. Survival mode with `difficulty peaceful` is not survival. |

Additionally, all of these produce visible chat messages. In a co-op session, the human player sees a stream of admin commands on every bot reconnect and between every task — `/gamerule keepInventory true`, `/time set 6000`, `/difficulty peaceful` — which makes the bot look broken.

---

## What Was Changed

**Four files, nine edit points.**

### `voyager/voyager.py`

1. **`__init__()`** — added `self.game_mode = os.environ.get("GAME_MODE", "creative")`. Stores the mode once at startup, makes it available to all methods.

2. **`reset()`** — gated the `/time set` + `/difficulty` step behind `game_mode == "creative"`:
   ```python
   if self.game_mode == "creative":
       events = self.env.step(
           "bot.chat(`/time set ${getNextTime()}`);\n"
           + f"bot.chat('/difficulty {difficulty}');"
       )
   else:
       events = self.env.step("")
   ```

3. **All seven `env.reset()` calls** — `"game_mode": self.game_mode` added to every `options` dict. This is critical: the bot reconnects on every task transition, error recovery, and at session start. If even one reset call omits `game_mode`, Node.js defaults to `"creative"` and re-enables the cheat gamerules on that reconnect. The seven call sites are: `rollout()`, `learn()` (resume branch), `learn()` (fresh start branch), `learn()` (error recovery hard), `learn()` (error recovery soft), `decompose_task()`, and `inference()`.

### `voyager/env/bridge.py`

4. **`reset()`** — added `"game_mode": options.get("game_mode", "creative")` to `reset_options`. This dict is sent as the body of every `POST /start` request, and is also re-used on automatic reconnect via `check_process()`.

### `voyager/env/mineflayer/index.js`

5. **`/start` handler, spawn callback** — stored `game_mode` on the bot object immediately after `initReactiveEngine(bot)`:
   ```js
   bot.game_mode = req.body.game_mode || "creative";
   ```
   Storing it on `bot` means all subsequent handlers (`/step`, reactive rules, future `chat.js`) can read it without needing to re-parse the request.

6. **`/start` handler, after `initCounter(bot)`** — gated training gamerules:
   ```js
   if (bot.game_mode !== "survival") {
       bot.chat("/gamerule keepInventory true");
       bot.chat("/gamerule doDaylightCycle false");
   }
   ```

7. **`/step` handler** — gated `returnItems()`:
   ```js
   if (bot.game_mode !== "survival") {
       await returnItems();
   }
   ```

### `voyager/control_primitives/givePlacedItemBack.js`

8. **Function body** — early return in survival mode:
   ```js
   async function givePlacedItemBack(bot, name, position) {
       if (bot.game_mode === "survival") return;
       // ... rest unchanged
   }
   ```
   This primitive uses `/gamerule doTileDrops false` and `/give bot ${name} 1` to reclaim placed blocks. It was not gated by the `returnItems()` fix in `index.js` because it is a separate file that ActionAgent-generated skill code can call directly. Without this guard, a generated skill could silently cheat mid-execution even in survival mode.

9. **`index.js`** — `bot.game_mode` is now set before `skills.inject(bot)` runs, so the value is available to any skill code evaluated in that session, including calls to `givePlacedItemBack`.

---

## How GAME_MODE Flows Through the System

```
.env: GAME_MODE=survival
  │
  ├─ voyager.py __init__
  │     self.game_mode = "survival"
  │
  ├─ voyager.py reset()   [called per task]
  │     → skips /time set and /difficulty step
  │     → passes "game_mode": "survival" to env.reset()
  │
  ├─ bridge.py reset()
  │     → reset_options["game_mode"] = "survival"
  │     → POST /start  { ..., game_mode: "survival" }
  │
  └─ index.js /start handler
        bot.game_mode = "survival"
        → keepInventory NOT sent
        → doDaylightCycle NOT sent

  index.js /step handler
        → returnItems() NOT called
```

The default value at every level is `"creative"`. If `GAME_MODE` is absent or set to `creative`, all original behavior is preserved exactly.

---

## What This Enables

| Phase 2 Feature | Was blocked by | Now unblocked |
|---|---|---|
| Feature 5 — Day/Night Cycle Awareness | `doDaylightCycle false` froze `timeOfDay` | `timeOfDay` advances naturally; CurriculumAgent time-gating works |
| Feature 6 — Death and Respawn | `keepInventory true` prevented item drops | Items drop on death; recovery logic is meaningful |
| Feature 3 — Shelter Building | `returnItems()` removed placed blocks | Placed blocks persist; built structures remain in the world |
| All features | Chat spam of admin commands per task cycle | Chat is clean; no admin output visible to the human player |

The `bot.game_mode` property stored at spawn is also the correct hook for Phase 2 Feature 4 (chat command handling). The `chat.js` module will read it to determine whether to process incoming player commands — in `creative` mode, chat handling can be skipped entirely.

---

## What Stays Unchanged

- **Hard reset** (`/clear @s`, `/kill @s`) — these are inside `if (req.body.reset === "hard")` and are only triggered by the initial session start, not per-task resets. Survival uses `"soft"` reset, so this code never fires. No change needed.
- **`GAME_MODE=creative` behavior** — fully preserved. The training loop works identically to before this change.
- **`_propose_next_task(game_mode)`** — already reads `GAME_MODE` from the environment directly. No change.
- **`run.py`** — no change. `voyager.py` reads `GAME_MODE` from the environment itself.
