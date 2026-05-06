# Node.js Side — Detailed Reference

## Express Server (`voyager/env/mineflayer/index.js`)

Launched as `node index.js <port>` (default 3000). Manages a single global `bot` variable.

---

## `POST /start`

**Request body**:
```json
{
    "port": 12345,
    "reset": "hard" | "soft",
    "inventory": {"oak_log": 3, ...},
    "equipment": [head, chest, legs, feet, mainhand, offhand],
    "spread": false,
    "waitTicks": 20,
    "position": {"x": 0, "y": 64, "z": 0}
}
```

**Flow**:
1. If bot exists → `bot.end()` (disconnect previous)
2. `mineflayer.createBot({host: "localhost", port: body.port, username: "bot", disableChatSigning: true})`
3. On `spawn` event:
   - **Hard reset**: `/clear @s`, `/kill @s`, then `/give @s minecraft:{item} {count}` for each inventory item; `/item replace entity @s {slot} with minecraft:{item}` for equipment (skips mainhand slot index 4)
   - **Teleport**: `/tp @s {x} {y} {z}` if position provided
   - **Plugins loaded**: `pathfinder`, `mineflayer-tool`, `collectblock`, `pvp`, `minecraftHawkEye`
   - `obs.inject(bot, [OnChat, OnError, Voxels, Status, Inventory, OnSave, Chests, BlockRecords])`
   - `skills.inject(bot)` — monkey-patches bot methods
   - If `spread`: `/spreadplayers ~ ~ 0 300 under 80 false @s`
   - `await bot.waitForTicks(bot.waitTicks * itemTicks)` — waits proportional to items given
   - `res.json(bot.observe())` — returns initial observation
   - `/gamerule keepInventory true` — items not dropped on death
   - `/gamerule doDaylightCycle false` — time controlled by Python

**Bot state initialized**:
```js
bot.waitTicks = req.body.waitTicks   // ticks to wait at end of each step
bot.globalTickCounter = 0            // total ticks elapsed
bot.stuckTickCounter = 0             // ticks moving without position change
bot.stuckPosList = []                // last 5 positions for stuck detection
bot.iron_pickaxe = false             // tracks if bot had iron pickaxe at start
```

---

## `POST /step`

**Request body**: `{"code": "await mineBlock(bot, 'oak_log', 3);", "programs": "..."}`

**Full execution flow**:
```
1. Load minecraft-data (mcData) for bot version
   - Patch legacy item names: leather_cap→leather_helmet, lapis_lazuli_ore→lapis_ore, etc.

2. Set up pathfinder:
   - new Movements(bot, mcData)
   - bot.pathfinder.setMovements(movements)

3. Reset counters:
   - bot.globalTickCounter = 0
   - bot.stuckTickCounter = 0
   - bot.stuckPosList = []

4. Register onTick listener:
   - Every physicTick: increment globalTickCounter
   - If pathfinder moving: increment stuckTickCounter
   - If stuckTickCounter >= 100: call onStuck(threshold=1.5)

5. bot.cumulativeObs = []
6. await bot.waitForTicks(bot.waitTicks)

7. evaluateCode(code, programs):
   eval("(async () => {" + programs + "\n" + code + "})()")

8. process.off("uncaughtException", otherError)
9. if eval returned error: bot.emit("error", handleError(err))

10. returnItems()

11. await bot.waitForTicks(bot.waitTicks)

12. res.json(bot.observe())
13. bot.removeListener("physicTick", onTick)
```

**`evaluateCode(code, programs)`**:
- Wraps everything in `(async () => { ... })()` — all primitives and skills are in scope
- Returns `"success"` or the caught error object

**`returnItems()`** — post-execution cleanup:
```js
bot.chat("/gamerule doTileDrops false")  // prevent duplicating drops

// Recover crafting table
const crafting_table = bot.findBlock({matching: mcData.blocksByName.crafting_table.id, maxDistance: 128})
if (crafting_table) {
    bot.chat(`/setblock ${x} ${y} ${z} air destroy`)
    bot.chat("/give @s crafting_table")
}

// Recover furnace (same pattern)

// If inventory nearly full (>= 32 slots) and no chest: give one
if (bot.inventoryUsed() >= 32 && !hasChest) bot.chat("/give @s chest")

// Restore iron_pickaxe if it was present at start but now missing
if (bot.iron_pickaxe && !hasIronPickaxe) bot.chat("/give @s iron_pickaxe")

bot.chat("/gamerule doTileDrops true")
```

**`onStuck(posThreshold=1.5)`**:
- Pushes current position to `stuckPosList` (max 5 entries)
- If oldest vs newest distance < 1.5 blocks → `teleportBot()`
- `teleportBot()`: finds air block within 1 block radius, teleports there; fallback: `/tp @s ~ ~1.25 ~`

**`handleError(err)`** — error attribution:
```js
const programs_length = programs.split("\n").length
// Find stack trace line in anonymous eval context
// If line_num >= programs_length → it's in user code
// match_line = line_num - programs_length
// Returns: "Your code:N\n{code_line}\n{err.message}\nat line M:{user_code_line} in your code"
```

---

## `POST /pause`

Sends `/pause` to Minecraft chat. This toggles the vanilla Minecraft pause command.
Used to freeze game state between Python steps. POST /pause again to unpause (it's a toggle).

---

## `POST /stop`

`bot.end()` — disconnects bot gracefully.

---

## Observation System (`lib/observation/`)

### Base class and injection (`base.js`)

```js
class Observation {
    constructor(bot) { this.bot = bot; this.name = "Observation"; }
    observe() { throw TypeError("must implement"); }
    reset() {}   // optional
}

function inject(bot, obs_list) {
    bot.obsList = obs_list.map(Cls => new Cls(bot))
    bot.cumulativeObs = []

    // Called by event-driven observers on each event
    bot.event = function(event_name) {
        const result = {}
        bot.obsList.forEach(obs => {
            if (obs.name.startsWith("on") && obs.name !== event_name) return
            result[obs.name] = obs.observe()
        })
        bot.cumulativeObs.push([event_name, result])
    }

    // Called by /step at the end to flush all accumulated observations
    bot.observe = function() {
        bot.event("observe")  // final snapshot
        const result = bot.cumulativeObs
        bot.cumulativeObs = []
        return JSON.stringify(result)
    }
}
```

**Key insight**: `bot.cumulativeObs` is a list of `[event_type, {observer_name: data}]` pairs. Event-driven observers (onChat, onError, onSave) push entries mid-step when their events fire. The final `bot.observe()` call pushes one more `"observe"` entry with all observer snapshots. Python receives this as the events list.

---

### Individual Observers

**`Status` (name: `"status"`)**:
```js
{
    health, food, saturation, oxygen,
    position,     // {x, y, z} from bot.entity.position
    velocity,     // {x, y, z}
    yaw, pitch,
    onGround,
    equipment,    // [head, chest, legs, feet, mainHand, offHand] — item names or null
    name,         // bot username
    biome,        // bot.blockAt(position).biome.name or "None"
    entities,     // {mob_name: distance} within 32 blocks, nearest only
    timeOfDay,    // "sunrise"|"day"|"noon"|"sunset"|"night"|"midnight"
    inventoryUsed,  // count of non-null slots 9-44
    elapsedTime,  // bot.globalTickCounter
}
```

`getTime()` bucketing:
- < 1000 → "sunrise", < 6000 → "day", < 12000 → "noon", < 13000 → "sunset"
- < 18000 → "night", < 22000 → "midnight", else → "sunrise"

`getEntities()`: iterates `bot.entities`, skips `player` and `item` types, keeps only mobs within 32 blocks. For each mob type, keeps only the nearest instance.

`getEquipment()`: slots 5-8 (armor) + mainHand + slot 45 (offhand). Returns item names.

---

**`Voxels` (name: `"voxels"`)**:
```js
getSurroundingBlocks(bot, 8, 2, 8)  // x_dist=8, y_dist=2, z_dist=8
// Returns Set of block names (not air) in 17×5×17 area around bot
```

**`BlockRecords` (name: `"blockRecords"`)**:
- On `physicsTick`, every 100 ticks: scans same 8×2×8 area, adds block names to `this.records` Set, excluding items in current inventory
- `observe()` returns `Array.from(this.records)` — all blocks seen since last reset
- `reset()` clears the Set

**`Inventory` (name: `"inventory"`)**:
```js
// Uses bot.currentWindow || bot.inventory (handles open containers)
items().reduce((acc, item) => {
    acc[item.name] = (acc[item.name] || 0) + item.count
    return acc
}, {})
```

**`Chests` (name: `"nearbyChests"`)**:
```js
// State: { position: {item:count} | "Unknown" | "Invalid" }
// On bot.on("closeChest"): stores chest contents
// On bot.on("removeChest"): marks as "Invalid"
// observe(): finds all chests within 16 blocks
//   - if not yet tracked → marks as "Unknown"
//   - returns this.chestsItems
```

**`onChat` (name: `"onChat"`)**:
```js
// Listens to bot.on("chatEvent") (emitted by patched bot.chat)
// Ignores messages starting with "/"
// Accumulates message text in this.obs
// On each event: bot.event("onChat") → pushed to cumulativeObs
// observe() returns accumulated text and resets
```

**`onError` (name: `"onError"`)**:
```js
// Listens to bot.on("error")
// Saves error object to this.obs
// On each event: bot.event("onError")
// observe() returns error and resets to null
```

**`onSave` (name: `"onSave"`)**:
```js
// Listens to bot.on("save") — emitted by patched bot.save()
// Used by skill code to checkpoint progress
// observe() returns event name string and resets
```

---

## Skill Loader (`lib/skillLoader.js`)

Monkey-patches `bot` to add safety and observability:

```js
// Sleep: add tick waits before and after
bot.sleep = async (bedBlock) => {
    await bot.waitForTicks(20); await bot._sleep(bedBlock); await bot.waitForTicks(135)
}

// Fish: timeout after 60s, requires fishing_rod in hand
bot.fish = async () => { /* ... */ }

// Consume: wait 20 ticks after eating
bot.consume = async () => { await bot._consume(); await bot.waitForTicks(20) }

// useOn: requires entity within 6 blocks
bot.useOn = async (entity) => {
    if (entity.position.distanceTo(bot.entity.position) > 6) {
        bot.chat("Please goto a place near the entity first!"); return
    }
    await bot._useOn(entity); await bot.waitForTicks(20)
}

// activateBlock: requires block within 6 blocks
bot.activateBlock = async (block) => {
    if (block.position.distanceTo(bot.entity.position) > 6) {
        bot.chat("Please goto a place near the block first!"); return
    }
    await bot._activateBlock(block)
}

// chat: emit chatEvent BEFORE sending (for onChat observer)
bot.chat = (message) => { bot.emit("chatEvent", "bot", message); bot._chat(message) }

// inventoryUsed: count non-null slots 9-44
bot.inventoryUsed = () => bot.inventory.slots.slice(9, 45).filter(s => s !== null).length

// save: emit "save" event (for onSave observer)
bot.save = (eventName) => bot.emit("save", eventName)
```

---

## Utils (`lib/utils.js`)

Time cycling for environment resets:

```js
// gameTimeList: [0,1000,2000,...,12000, 13000,15000,17000,...,23000]
// getNextTime(): increments counter, returns next time value
// Used in Python's reset(): bot.chat(`/time set ${getNextTime()}`)
// Cycles through day/night sequence to vary observation diversity
```

---

## Loaded Plugins

| Plugin | Purpose |
|---|---|
| `mineflayer-pathfinder` | A* pathfinding — `bot.pathfinder.goto(goal)` |
| `mineflayer-tool` | Auto tool selection — `bot.tool.equipForBlock(block)` |
| `mineflayer-collectblock` | High-level block collection with pathfinding |
| `mineflayer-pvp` | Combat — `bot.pvp.attack(entity)` |
| `minecrafthawkeye` | Projectile trajectory calculation for ranged attacks |

`mineflayer-collectblock` is a **local `file:` dependency** compiled from TypeScript:
```
mineflayer-collectblock/
├── src/
│   ├── index.ts        # plugin entry point, exposes bot.collectBlock
│   ├── BlockVeins.ts   # ore vein detection and multi-block targeting
│   ├── Inventory.ts    # inventory management during collection
│   ├── Targets.ts      # target block filtering and prioritization
│   ├── TaskQueue.ts    # async task queue for sequential operations
│   └── Util.ts         # shared helpers
└── tsconfig.json       # compiles to lib/ directory
```
Must run `npx tsc` in this directory before `npm install` in the parent.

---

## Node.js Package Dependencies (`package.json`)

Key pinned version:
- `prismarine-block: "=1.16.3"` — exact pin, newer versions break bot interaction logic

Other notable packages:
- `@babel/core` / `@babel/generator` — used by Python's ActionAgent via `javascript` PyPI package to parse LLM-generated JS AST
- `minecraft-data` — provides block/item/recipe data for the specific Minecraft version
- `magic-string` — source map manipulation
- `vec3` — 3D vector math
- `graceful-fs` — cross-platform filesystem operations

---

## Data Flow: Python Receives Observations

A single `env.step()` call returns a list like:
```json
[
    ["onChat", {"onChat": "I cannot make wooden_pickaxe because I need: crafting table"}],
    ["onError", {"onError": "...error message..."}],
    ["onSave", {"onSave": "cobblestone_mined"}],
    ["observe", {
        "status": { "health": 20, "position": {...}, "biome": "plains", ... },
        "voxels": ["grass_block", "dirt", "oak_log", ...],
        "blockRecords": ["oak_log", "cobblestone", ...],
        "inventory": {"oak_log": 3, "stick": 2},
        "nearbyChests": {"(10, 64, 5)": {"cobblestone": 32}},
        "onChat": null,
        "onError": null,
        "onSave": null
    }]
]
```

Python always validates `events[-1][0] == "observe"`. The final `observe` entry is the authoritative snapshot; earlier entries are event-driven updates that happened during code execution.
