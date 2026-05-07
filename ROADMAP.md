# Voyager Buddy — Development Roadmap

## Vision

Transform Voyager from a solo lifelong-learning agent into a fully autonomous survival companion that a real player can explore, build, and play Minecraft with. The buddy should feel responsive, capable, and genuinely helpful — not a scripted NPC, but an agent that understands the game, adapts to the player's goals, and contributes meaningfully to shared progress.

---

## How to Read This Document

Phases are ordered by dependency, not by effort. Each phase unblocks the next. Within a phase, items are listed from highest to lowest priority.

**Architectural blockers come first.** Until they are resolved, none of the gameplay features are buildable on a solid foundation.

**Cooperative logic comes last.** The buddy must be fully capable on its own before it can meaningfully cooperate with a human. A bot that can't survive alone can't protect a player.

### Detailed Technical Design

Each phase has a companion document in `docs/roadmap/` with full technical decisions, file change lists, and implementation notes.

| Phase | Technical Design Document |
|---|---|
| Phase 1 | [docs/roadmap/phase-1-architectural-foundations.md](docs/roadmap/phase-1-architectural-foundations.md) |
| Phase 2 | [docs/roadmap/phase-2-survival-core.md](docs/roadmap/phase-2-survival-core.md) |

---

## Phase 1 — Architectural Foundations

**Goal:** Make the system structurally capable of survival co-op. Remove the hard blockers that make the current architecture incompatible with any of the planned directions.

**Why first:** These are not features — they are prerequisites. Persistence, real-time operation, and survival mode are all required before a single survival mechanic can be implemented.

---

### 1.1 — Dual-Layer Architecture (Reactive + Strategic)

**The core blocker.** Currently the bot pauses the entire game while waiting for an LLM response (1–3 seconds per step). Combat, hunger crises, and fall damage cannot wait 3 seconds.

**Target design:**

```
Node.js (always running, no pauses)
├── Reactive layer — rules engine, <50ms response
│   ├── Auto-eat when hunger < 6
│   ├── Flee when health < 4 hearts
│   ├── Dodge lava, void, fall hazards
│   ├── Attack nearest hostile mob if engaged
│   └── Follow player if in follow mode
└── Goal executor — runs current strategic goal from Python

Python (async, non-blocking)
└── Strategic layer — LLM-driven, called when goal changes
    ├── Task planning and decomposition
    ├── Crafting decisions
    ├── Exploration targeting
    └── Chat understanding and response
```

The `pause`/`unpause` calls must be removed from the hot path. LLM calls must become asynchronous — the bot continues reacting while Python waits for a response.

**Key technical changes:**
- Remove `env.pause()` / `env.unpause()` from the step loop
- Add a `set_goal` endpoint alongside the existing `/step` endpoint
- Reactive rules engine implemented in Node.js, independent of Python
- Python sends goals/intents; Node.js pursues them continuously

---

### 1.2 — Persistent Session State (Remove Hard Reset)

Currently `env.reset("hard")` clears the bot's inventory and kills it between every task. In survival, inventory is accumulated progress — destroying it between tasks is fatal to the concept.

**Target behavior:**
- Hard reset occurs only at explicit session start (optional)
- Between tasks: no inventory wipe, no kill command
- Soft reset (bot reconnect) remains available for error recovery
- Chest memory, skill library, and curriculum persist normally

**Key technical changes:**
- Remove `/clear @s` and `/kill @s` from the default reset path
- Add `reset_mode` configuration: `"none"` | `"soft"` | `"hard"`
- Default to `"none"` for survival sessions

---

### 1.3 — Player Presence in Observation Space

The bot currently has no knowledge that a player exists in the world. Player position, health, inventory, and proximity are absent from all observations.

**Additions to observation JSON from Node.js:**
- `nearbyPlayers` — list of players within 64 blocks: `{username, position, health, distance}`
- `playerInventory` — items in the human player's inventory (requires server-side access or agreement on data passing)
- `playerActivity` — inferred from player movement and tool use

**Key technical changes:**
- Extend `Status` observation module in `mineflayer/lib/observation/`
- Use `bot.players` and entity tracking from Mineflayer API
- Expose player data to Python via the existing observation JSON structure

---

### 1.4 — Survival Mode Support

The entire system assumes Creative + Peaceful. Prompts, observation parsing, and the curriculum agent all ignore hunger, health loss, and hostile mobs as real threats.

**Changes required:**
- Expose `bot.food`, `bot.health`, `bot.oxygenLevel` in observations (already partially available in Mineflayer)
- Add survival stats to all agent prompts (ActionAgent, CurriculumAgent, CriticAgent)
- Remove the Peaceful assumption from CurriculumAgent warm-up thresholds
- CriticAgent must evaluate survival state as a success/failure condition
- Update `.env.example` with a `GAME_MODE=survival` flag

---

**Phase 1 Milestone:** The bot runs in Survival mode without crashing or resetting its inventory when damaged. It reacts to taking damage without waiting for an LLM call. The player can observe the bot in the world.

---

## Phase 2 — Survival Core

**Goal:** The bot can keep itself alive through multiple Minecraft days and nights autonomously. It also responds to basic player chat commands.

**Why second:** Survival mechanics build directly on Phase 1's persistent state and reactive layer. Basic chat is included here — not as a communication feature, but as a development tool. Testing survival without the ability to give the bot a quick command requires restarting code.

---

### 2.1 — Hunger and Food Management

- Reactive layer auto-eats from inventory when hunger < 6 points
- Strategic layer prioritizes food gathering when no food is available
- CurriculumAgent includes food sufficiency as a task selection factor
- Bot understands cooked vs raw food calorie values and prefers cooked

---

### 2.2 — Health Management and Hazard Avoidance

- Reactive layer flees from engagements when health < 4 hearts (2 full hearts)
- Bot avoids standing in lava, fire, or cactus
- Bot understands fall damage — uses water bucket placement before long falls
- Healing priority: natural regeneration if food is full; potions if available

---

### 2.3 — Hostile Mob Handling

The curriculum currently bans any task involving hostile mobs as defenders. In survival, mobs are an environmental constant, not optional tasks.

- Reactive layer attacks mobs that enter within 5 blocks
- Strategic layer decides: fight (if equipped) or flee (if not)
- Night is recognized as a high-threat period
- CurriculumAgent proposes combat gear crafting before nightfall

---

### 2.4 — Shelter Building

The curriculum prompt explicitly forbids building tasks. This must be revised for survival mode — a first night without shelter means death.

- Remove the no-building restriction from `curriculum.txt` for survival mode
- Add shelter-related control primitives: `buildShelter`, `sealCaveEntrance`, `placeLight`
- CurriculumAgent proposes shelter construction when night is approaching and no shelter exists
- Minimum viable shelter: 4 walls, 1 door, lighting — dirt/wood acceptable at first

---

### 2.5 — Day/Night Cycle Awareness

- `timeOfDay` is already present in observations — wire it into decision logic
- Behavioral mode switching: daytime = explore/gather, evening = return/prepare, night = shelter/fight
- CurriculumAgent accounts for time when proposing the next task

---

### 2.6 — Death and Respawn Handling

- On death: log item drop location, return to recover items
- CurriculumAgent proposes recovery as the first task after respawn
- If items are unrecoverable (e.g., lava), acknowledge and reprioritize

---

### 2.7 — Basic Chat Commands

- `bot.on('chat')` listener in Node.js (Mineflayer already supports this)
- Keyword-based parser for immediate commands: `come`, `stop`, `follow`, `stay`, `give me [item]`, `craft [item]`, `what are you doing`
- Bot acknowledges commands in chat
- LLM-powered interpretation added in Phase 4; this is rule-based

---

**Phase 2 Milestone:** Bot survives three consecutive Minecraft days in Survival/Normal difficulty solo. It builds a basic shelter before the first night, maintains food, handles hostile mobs, and responds to simple player chat commands.

---

## Phase 3 — Progression and Tech Tree

**Goal:** The bot can advance through all major Minecraft progression stages independently and prepare for cooperative end-game content.

**Why third:** Progression requires stable survival as a foundation. A bot that can't survive night cannot meaningfully pursue diamond gear or the Nether.

---

### 3.1 — Complete Tool and Armor Progression

Current skill library reaches iron tier inconsistently. This phase formalizes the full chain:

`Wood → Stone → Iron → Diamond → Netherite`

- CurriculumAgent understands tier prerequisites (iron pickaxe required before diamond mining)
- Bot actively upgrades tools when better materials are available
- Armor maintenance: repair or replace before combat engagements

---

### 3.2 — Nether Preparation and Traversal

- New control primitives: `buildNetherPortal`, `lightPortal`, `navigateNether`
- Bot collects 10 obsidian (via bucket-and-water or mining with diamond pickaxe)
- Navigates Nether biomes: Nether Wastes, Basalt Deltas, Crimson/Warped Forests, Bastion Remnants
- Priority Nether resources: blaze rods, nether wart, quartz, ancient debris
- Fire resistance potion required before entering — bot prioritizes crafting it

---

### 3.3 — Enchanting System

- Crafting enchanting table (requires diamonds and obsidian — natural dependency on 3.1)
- Lapis collection integrated into routine mining
- XP management: bot understands experience levels and plans enchanting after reaching level 30
- Enchantment priority: `Efficiency`, `Fortune`, `Protection`, `Unbreaking`, `Mending`
- Anvil and book-based enchanting for targeted outcomes

---

### 3.4 — Brewing System

- Brewing stand setup (requires blaze rod from 3.2)
- Key potions in priority order:
  1. Fire Resistance — required for Nether and lava situations
  2. Healing / Regeneration — combat survival
  3. Night Vision — cave exploration efficiency
  4. Strength — boss combat
- Ingredient collection integrated into exploration goals

---

### 3.5 — Farming and Animal Husbandry

Current skill library relies entirely on hunting and foraging for food. This is unsustainable at scale.

- Crop farming: wheat, carrots, potatoes, beetroot, melons, pumpkins
- Animal breeding: cows (steak + leather), pigs (porkchop), sheep (wool + mutton), chickens (eggs + meat)
- Bot establishes a home farm area near the base
- CurriculumAgent includes farm maintenance in idle task selection

---

### 3.6 — Villager Trading

- Finding and navigating to villages
- Trade mechanics: identify and use librarians (enchanted books), farmers (food), weaponsmiths, armorers
- Emerald farming through crop trading
- Curing zombie villagers for discounted trades

---

### 3.7 — End Preparation

- Ender pearl collection (Enderman hunting or trader purchase)
- Blaze powder from blaze rods (Phase 3.2 dependency)
- Eye of Ender crafting
- Stronghold location via triangulation (`throw_eye_of_ender` primitive)
- End portal room navigation and activation

---

**Phase 3 Milestone:** Bot independently enters the Nether, collects ancient debris, crafts netherite gear, locates a stronghold, and reaches the End portal room.

---

## Phase 4 — Communication and Personality

**Goal:** Conversations with the bot feel natural and contextually aware. The bot proactively communicates relevant information.

**Why fourth:** Communication requires a capable bot behind it. A personality layered over an agent that cannot survive or craft is hollow. By Phase 4, the bot can actually do the things it talks about.

---

### 4.1 — Natural Language Command Understanding

Replace the Phase 2 keyword parser with LLM-powered chat interpretation:

- Full sentence understanding: "Can you go mine some iron? I need about 20 ingots"
- Multi-turn context: bot remembers what was discussed in the last few messages
- Ambiguity handling: "What iron?" → bot asks for clarification
- Rejection with reason: "I can't mine diamond right now, I only have a stone pickaxe"

---

### 4.2 — Proactive Communication

The bot should feel like a teammate, not a tool waiting for input:

- Reports discoveries: "Found a mineshaft at X Y Z, want to explore it?"
- Warns the player: "Night in 2 minutes, we should head back"
- Asks for resources: "I'm out of food, do you have anything I can eat?"
- Updates on long tasks: "Still smelting, 12/20 done"

---

### 4.3 — Status Queries

Player can ask natural language questions:

- "What are you doing?" → current task and progress
- "What's in your inventory?" → formatted inventory summary
- "Where are we?" → coordinates and nearest landmark/biome
- "What should we do next?" → CurriculumAgent recommendation explained in plain language

---

### 4.4 — Personality System

A consistent persona makes the buddy feel like a companion rather than a CLI:

- Assign a name and a brief personality description (configurable in `.env`)
- Tone options: enthusiastic, calm, dry, cautious
- Contextual reactions: excitement on finding diamonds, concern on low health, satisfaction on completing a hard task
- Personality influences phrasing, not decisions — it is a presentation layer

---

**Phase 4 Milestone:** A player who has never read the documentation can interact with the bot naturally via chat, understand what it is doing, direct it, and receive useful information without technical knowledge.

---

## Phase 5 — Cooperative Logic

**Goal:** Bot and player function as a genuine team. The bot understands the player's needs and adapts its behavior to complement them.

**Why fifth:** Every prior phase has built a self-sufficient agent. Only now does it make sense to teach the bot to defer, share, and cooperate — because it already knows how to do everything independently.

---

### 5.1 — Player Tracking and Proximity Behavior

- Follow player through the world on command
- Maintain configurable follow distance (default: 6–10 blocks)
- Wait at doorways, ledges, and portals for the player
- Teleport to player if separated by more than 100 blocks (configurable)

---

### 5.2 — Shared Goal Model

- Player declares a goal: "We're going to the Nether tonight"
- Bot decomposes it accounting for both inventories: what the player has, what the bot has, what is missing
- Tasks are divided between the two: "I'll get the obsidian, can you get the flint and steel?"
- Bot tracks player progress on their subtasks via observation

---

### 5.3 — Task Division and Role System

- Bot proposes a role based on current gear and situation: Scout, Miner, Builder, Combat Support, Crafter
- Player can accept, reject, or assign a different role via chat
- Roles influence CurriculumAgent task selection and reactive layer priorities

---

### 5.4 — Resource Sharing Protocol

- Bot tracks what the player has and identifies gaps
- Proactively offers: "You have no food left, I can give you some cooked steak"
- On player request: transfers specific items via drop-and-pickup or direct trade
- Shared chest inventory: both bot and player store surplus in a designated base chest

---

### 5.5 — Player Protection

- Reactive layer prioritizes attacks on mobs targeting the player over self-defense
- Bot interposes itself between player and hostile mobs when player health is low
- Provides healing items (potions, food) to player when player health is critical
- Does not steal aggro from a mob the player is intentionally fighting

---

**Phase 5 Milestone:** Bot and player together complete a full progression sequence — entering the Nether, collecting netherite, enchanting gear — with the bot contributing meaningfully at each step and adapting to the player's decisions.

---

## Phase 6 — World Memory and End Game

**Goal:** The buddy remembers shared history, maintains a persistent world model, and cooperates on late-game content including the Ender Dragon.

---

### 6.1 — Persistent World Model

- Map of explored areas, biomes, and notable locations stored in a structured file
- Named locations: base, mine shaft, village, Nether portal, stronghold
- Bot can navigate to named locations by name: "Head back to base"
- Danger zones remembered: "Last time we went south we found a lot of creepers"

---

### 6.2 — Session Memory

- Summary of the previous session stored in checkpoint on shutdown
- On next session start, bot recaps: "Last time we were working on getting to the Nether, we had 8 of the 10 obsidian we needed"
- Ongoing projects persist: active farm, incomplete builds, pending goals

---

### 6.3 — Ender Dragon and End Game

- Stronghold navigation (Phase 3.7 dependency)
- End portal activation and entry
- Ender Dragon fight coordination: destroy crystals, avoid beams, timing attacks
- Elytra retrieval from End ships
- Post-dragon content: Wither boss (beacon), End cities, full Netherite armor

---

### 6.4 — Post-Game and Open World

- Beacon construction and activation
- Raid farming (village protection mechanics)
- Ancient city / Deep Dark exploration (Warden avoidance)
- Continuous open-world play: bot proposes new objectives once main progression is complete

---

**Phase 6 Milestone:** The Ender Dragon is defeated in a cooperative session. The bot references shared history from previous sessions and continues proposing meaningful objectives in the open world.

---

## Open Questions and Research Directions

These are unresolved design decisions that will need experimentation:

**LLM latency in real-time combat.** Even with the reactive layer, strategic decisions (flee vs fight, which weapon to use) still go through Python. Sub-500ms LLM responses would be needed for fluid combat. Options: smaller model for reactive decisions, cached heuristics, or pre-compiled decision trees for common combat scenarios.

**Player inventory observation.** Mineflayer can see nearby entities and their equipment, but cannot read another player's inventory without a server-side plugin or explicit data sharing. Phase 5 resource sharing may require a lightweight companion mod or an agreed-upon chest protocol.

**Model selection per layer.** The dual-layer architecture creates an opportunity to use a smaller, faster model for the reactive layer decisions (food, flee, follow) and reserve the larger model for strategic planning and chat. This would reduce latency and cost.

**Personality vs capability balance.** A highly verbose personality layer will slow down the chat interface. The personality system should be configurable in depth — from full roleplay to terse operational updates.

---

## Dependency Graph

```
Phase 1: Architectural Foundations
    │
    ├── Dual-layer (reactive + strategic)
    ├── Persistent session state
    ├── Player in observation space
    └── Survival mode support
         │
Phase 2: Survival Core
    │
    ├── Hunger / health / hazards
    ├── Hostile mob handling
    ├── Shelter building
    ├── Day/night awareness
    ├── Death handling
    └── Basic chat commands
         │
Phase 3: Progression & Tech Tree
    │
    ├── Full tool/armor progression
    ├── Nether + Ancient Debris
    ├── Enchanting + Brewing
    ├── Farming + Animal husbandry
    ├── Villager trading
    └── End preparation
         │
Phase 4: Communication & Personality
    │
    ├── NLP command understanding
    ├── Proactive communication
    ├── Status queries
    └── Personality system
         │
Phase 5: Cooperative Logic
    │
    ├── Player tracking + following
    ├── Shared goal model
    ├── Task division + roles
    ├── Resource sharing
    └── Player protection
         │
Phase 6: World Memory & End Game
    │
    ├── Persistent world model
    ├── Session memory
    ├── Ender Dragon + End content
    └── Post-game open world
```
