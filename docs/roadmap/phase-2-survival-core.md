# Phase 2 — Survival Core: Technical Design

## Overview

Phase 2 makes the bot capable of staying alive through multiple Minecraft days and nights without human intervention. It builds directly on Phase 1's reactive layer, persistent session state, and survival mode support.

The six features are ordered by implementation priority — each one reduces the most immediate cause of death:

1. Hunger and food management
2. Hostile mob handling (fight/flee + pillar)
3. Shelter building + experience-based learning
4. Basic chat commands
5. Day/night cycle awareness and home concept
6. Death and respawn handling

---

## Feature 1 — Hunger and Food Management

### Reactive layer (Phase 1 baseline)

The Phase 1 reactive layer already triggers on `hunger ≤ 4` (Priority 2 — MEDIUM). Phase 2 defines exactly what happens when that trigger fires: which food to eat, and what to do when no food is available.

### Food priority queue

When auto-eat fires, the bot selects from its inventory using a saturation-first ranking:

| Food item | Hunger restored | Saturation |
|---|---|---|
| Cooked beef / porkchop | 8 | 12.8 |
| Cooked mutton / chicken | 6 | 9.6 |
| Bread | 5 | 6.0 |
| Cooked salmon / cod | 5 | 6.0 |
| Apple | 4 | 2.4 |
| Raw meat (any) | 3 | 1.8 |

Rule: always prefer cooked over raw; always prefer higher saturation within the same tier. This logic is implemented in the reactive `actions.js` module introduced in Phase 1.

### When no food is available

If the inventory contains no edible items, the reactive layer sets a `no_food` flag in the shared bot state. The survival override layer in Python (Phase 1, Blocker 4) detects this on the next planning cycle and injects a mandatory food-gathering task before any other proposal from CurriculumAgent:

```
Priority of food tasks:
1. Eat if food is in inventory (reactive, immediate)
2. Cook raw meat if furnace is accessible and raw meat is in inventory
3. Hunt nearby animals if a weapon is equipped
4. Craft basic food if ingredients available (e.g., bread from wheat)
5. Explore to find food (last resort)
```

CurriculumAgent receives a `Food in inventory` field in its prompt so it can reason about food scarcity when proposing longer-term tasks.

---

## Feature 2 — Hostile Mob Handling

### Two-layer structure

Reactive layer (Node.js): detects and executes fight/flee within the polling interval.  
Strategic layer (Python/CurriculumAgent): proactively prepares — proposes crafting a weapon before nightfall, interprets survival experiences to propose better defensive strategies.

### Fight/flee decision logic

Triggered at Priority 2 (MEDIUM) when a hostile mob is detected within 6 blocks:

```
if health < 8 hearts:
    → flee unconditionally

elif mob_type == "creeper" AND distance < 5 blocks:
    → flee (explosion radius: 3 blocks, 1.5s fuse, not worth engaging)

elif no weapon in hand:
    → flee + attempt to equip best available melee weapon from inventory

elif mob_type in ["spider", "cave_spider"] AND count > 1:
    → flee (multiple spiders overwhelm single melee quickly)

elif weapon equipped AND health >= 8:
    → engage using existing killMob primitive

else:
    → flee
```

### Flee behavior: human-like escalation

When flee is triggered, the bot follows a two-step escalation — the same pattern an experienced Minecraft player uses:

**Step 1 — Sprint away**  
Sprint in the direction opposite the centroid of the nearest hostile mob cluster for 10–15 blocks. Re-check if mobs are still within 10 blocks.

**Step 2 — Pillar up**  
If mobs are still pursuing after sprinting:
1. Select any solid block from inventory (preference: cobblestone > dirt > any available block)
2. Execute `pillarUp(bot, material, 4)` — jump and place a block underfoot, repeat 4 times
3. Wait on the pillar until mobs despawn or retreat

Pillar is effective against zombies, skeletons, creepers, and endermen. Spiders can climb pillars — the appropriate counter (cap block on top) is learned through the experience mechanism described in Feature 3.

If home position is known and within 50 blocks, sprint toward home instead of pillaring — reaching a sealed shelter is preferable to being exposed on a pillar.

### New control primitive: `pillarUp`

New file: `voyager/control_primitives/pillarUp.js`

```js
async function pillarUp(bot, material, height = 4) {
    const item = bot.inventory.findInventoryItem(
        mcData.itemsByName[material]?.id, null
    );
    if (!item) {
        bot.chat(`No ${material} to pillar with`);
        return;
    }
    await bot.equip(item, "hand");
    for (let i = 0; i < height; i++) {
        await bot.setControlState("jump", true);
        await bot.waitForTicks(3);
        await bot.placeBlock(
            bot.blockAt(bot.entity.position.offset(0, -1, 0)),
            new Vec3(0, 1, 0)
        );
        await bot.setControlState("jump", false);
    }
    bot.save("pillar_built");
}
```

Also added to `voyager/control_primitives_context/pillarUp.js` as API documentation for the ActionAgent prompt.

### Strategic combat preparation

CurriculumAgent receives a new implicit priority rule in `curriculum.txt`:

> If time of day is approaching evening (timeOfDay > 8000) and no weapon is equipped or in inventory, propose crafting a wooden sword before any other task.

This prevents the bot from being caught unarmed at night.

---

## Feature 3 — Shelter Building and Experience-Based Learning

### Approach: LLM-generated building + episodic survival memory

The building restriction in `curriculum.txt` is removed for survival mode. The bot learns to build shelter the same way it learned to mine and craft — through iterative LLM-generated code, failure, and retry.

What prevents early deaths while the bot is still learning to build: the `pillarUp` primitive from Feature 2 serves as an emergency fallback for the first nights. The bot survives on pillars while its shelter-building skills develop.

### Episodic survival memory

The bot records significant survival events in a new checkpoint file. These events are fed back into CurriculumAgent's prompt as "lessons from experience", driving increasingly informed building decisions.

**New checkpoint file:** `ckpt/survival/experiences.json`

```json
[
  {
    "type": "death",
    "cause": "zombie",
    "context": "outdoors at night, no shelter",
    "lesson": "need enclosed shelter before nightfall",
    "timestamp": 1234567890
  },
  {
    "type": "damage",
    "source": "spider",
    "context": "on 4-block pillar",
    "lesson": "spiders climb pillars — pillar needs a cap block on top",
    "timestamp": 1234567891
  }
]
```

**New Python module:** `voyager/agents/survival_memory.py`

Two public functions:
- `record_event(event_type, cause, context)` — appends a structured entry to `experiences.json`. The `lesson` field is generated by a brief LLM call using the skill model (`gpt-5.4-nano`) to keep cost low.
- `get_recent_lessons(n=5)` — returns the last N lessons as a formatted string for prompt injection.

**CurriculumAgent prompt addition** in `curriculum.txt`:

```
Recent survival experiences (most recent first):
{survival_lessons}
Use these to inform shelter design and threat response decisions.
```

**Event capture sources:**

| Event | Source | Captured in |
|---|---|---|
| Bot died | `bot.on('death')` in Node.js | `recentReactiveEvents` → Python |
| Bot took significant damage (> 4 hearts in one encounter) | `bot.on('entityHurt')` in Node.js | `recentReactiveEvents` → Python |
| Shelter successfully built | `bot.save('shelter_built')` emitted from skill | `onSave` observation → Python |

Python records events in `voyager.py` when `recentReactiveEvents` contains relevant entries at the start of each planning cycle.

### `isSheltered` flag

Added to `voyager/env/mineflayer/lib/observation/shelter.js` (new file):

```
isSheltered = true when:
  - Block directly above bot is solid (not air, not leaves)
  - At least 3 of 4 horizontal adjacent blocks are solid
  - At least 1 light source within 5 blocks (prevents hostile spawning inside)
```

Exposed in the Status observation. CurriculumAgent uses this to determine whether to propose shelter construction before night.

### Building restriction change

In `curriculum.txt`, survival mode removes the following rule:

> ~~"All the placing, building, planting, and trading tasks should be avoided."~~

Replaced with:

> "Building tasks are allowed when shelter is needed for survival. Prioritize functional shelter (enclosed space with light) over aesthetic construction."

Planting and trading restrictions remain — these are Phase 3 features.

### Future direction

Observing and learning from other players' construction patterns is a viable long-term extension (Phase 5–6). When the player builds something near the bot, the structure geometry and material choices could be recorded and used as reference examples for the bot's own building prompts.

---

## Feature 4 — Basic Chat Commands

### Architecture

Mineflayer provides `bot.on('chat', (username, message, translate, jsonMsg, matches) => {})`.

A new module `voyager/env/mineflayer/lib/chat.js` handles:
1. Filtering — only processes messages from connected human players (not the bot itself, not other bots)
2. Parsing — rule-based keyword matching for Phase 2
3. Execution — direct Node.js actions for immediate commands; flagged in observations for Python-driven tasks
4. Response — `bot.chat()` with a short acknowledgement

The parser interface is explicitly designed for Phase 4 replacement: `parseCommand(message)` returns a structured command object `{action, args}`. In Phase 4, this function is swapped for an LLM call; the execution pipeline remains unchanged.

### Supported commands

| Player input | Bot action | Handled by |
|---|---|---|
| `come` / `come here` | Pathfind to player position | Node.js |
| `stop` / `halt` | Clear pathfinder goal, pause current task | Node.js |
| `follow me` / `follow` | Enable follow mode in reactive layer | Node.js |
| `stay` / `stay here` | Disable follow mode | Node.js |
| `go home` | Pathfind to home position | Node.js |
| `set home here` | Set home to current bot position | Node.js + persist |
| `what are you doing` / `status` | Report current task in chat | Node.js |
| `inventory` / `inv` | Report inventory summary in chat | Node.js |
| `give me [item]` | Drop item near player | Node.js |
| `craft [item]` | Inject craft task into Python goal queue | Python (via observations) |

Commands that require LLM planning (craft, complex requests) are appended to a `pendingChatTasks` list in the observations JSON. Python processes this list at the start of the next planning cycle and inserts the task ahead of the normal CurriculumAgent proposal.

### Observation additions

New field in observations JSON:

```json
{
  "recentChatCommands": [
    {
      "username": "Steve",
      "raw": "craft iron sword",
      "parsed": { "action": "craft", "args": { "item": "iron_sword" } },
      "handled_by": "python",
      "timestamp": 1234567890
    }
  ]
}
```

---

## Feature 5 — Day/Night Cycle Awareness and Home Concept

### Home position

**New checkpoint file:** `ckpt/survival/home.json`

```json
{
  "position": { "x": 12, "y": 64, "z": -8 },
  "set_at": 1234567890,
  "set_by": "bot"
}
```

Home is set when:
- Bot successfully completes a shelter-building skill → `set_by: "bot"`
- Player sends `set home here` → `set_by: "player"` (takes precedence, cannot be overridden by bot)

If no home is set: flee behavior defaults to `pillarUp`. CurriculumAgent proposes building a base as a high-priority task until home is established.

### Day/night behavioral modes

`timeOfDay` is already present in observations. Two additions:

- `isDaytime` — boolean, `true` if `timeOfDay < 13000`
- `timeUntilNight` — seconds until nightfall, computed from `timeOfDay`; `0` if already night

CurriculumAgent task selection is gated by time of day:

| Time of day | Mode | CurriculumAgent bias |
|---|---|---|
| 0–8000 (morning, day) | Explore | Normal task selection |
| 8000–11000 (afternoon) | Prepare | Prefer tasks that finish quickly; start heading toward home |
| 11000–13000 (dusk) | Return | Override: return to home or build shelter if none exists |
| 13000–23000 (night) | Shelter | Override: stay inside; fight only if mobs enter shelter |
| 23000–24000 (pre-dawn) | Standby | Wait; prepare first daytime task |

The time-of-day gate is implemented in the survival override layer in `voyager.py`, alongside the hunger and health overrides from Phase 1.

---

## Feature 6 — Death and Respawn Handling

### Event capture

`bot.on('death')` handler added in `mineflayer/index.js`:
- Records death position (`bot.entity.position`) before Minecraft resets it
- Records timestamp
- Records nearest hostile entity if one exists (cause inference)
- Appends `{type: "death", position, timestamp, inferred_cause}` to `recentReactiveEvents`

### Python death handling

In `voyager.py`, when `recentReactiveEvents` contains a death event at the start of a planning cycle:

1. Call `survival_memory.record_event("death", cause, context)` — add to `experiences.json`
2. Compute `items_despawn_at = death_timestamp + 300` (Minecraft item despawn: 5 minutes)
3. If current time < `items_despawn_at` AND death position within 150 blocks:
   - Inject "Recover items from [X, Y, Z]" as the immediate next task
4. If current time >= `items_despawn_at` OR death position > 150 blocks:
   - Log loss, continue from current inventory state
5. Clear current goal, run CurriculumAgent from the post-respawn observation

### Spawn point awareness

If the bot is killed and respawns far from home (e.g., spawn point is not the home base), CurriculumAgent receives the home position and current position in context and will propose navigating home as a high-priority task before resuming normal play.

---

## File Change Summary

| File | Change |
|---|---|
| `voyager/control_primitives/pillarUp.js` | New — pillar up primitive |
| `voyager/control_primitives_context/pillarUp.js` | New — LLM-facing documentation |
| `voyager/env/mineflayer/lib/chat.js` | New — chat listener and rule-based parser |
| `voyager/env/mineflayer/lib/observation/shelter.js` | New — isSheltered observation flag |
| `voyager/env/mineflayer/lib/reactive/rules.js` | Modified — add mob fight/flee rules, food auto-eat priority |
| `voyager/env/mineflayer/lib/reactive/actions.js` | Modified — add fleeFromMobs(), pillarUp call, eatBestFood() |
| `voyager/env/mineflayer/index.js` | Modified — initialize chat module, add death handler, add isSheltered and recentChatCommands to observations |
| `voyager/agents/survival_memory.py` | New — record_event(), get_recent_lessons() |
| `voyager/voyager.py` | Modified — death handling, experience recording, day/night override, pendingChatTasks processing |
| `voyager/agents/curriculum_agent.py` | Modified — survival experiences in prompt, day/night mode gating, building restriction removed for survival mode |
| `voyager/agents/action_agent.py` | Modified — parse isSheltered, home position, timeUntilNight |
| `voyager/prompts/curriculum.txt` | Modified — survival experiences section, day/night rules, revised building rule |
| `voyager/prompts/action_template.txt` | Modified — isSheltered, home position, timeUntilNight |
| `ckpt/survival/experiences.json` | New checkpoint file — episodic survival memory |
| `ckpt/survival/home.json` | New checkpoint file — home position |
