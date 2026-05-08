# Architecture Overview

## Two Runtimes

The system has two independent runtimes that communicate over HTTP:

```
Python (localhost)                    Node.js (localhost:3000)
─────────────────────                 ──────────────────────────
voyager.py                            index.js (Express)
  └── agents/                           ├── /start  — spawn bot
        ├── curriculum.py               ├── /step   — run JS code, return obs
        ├── action.py                   └── /pause  — freeze server (reset only)
        ├── critic.py
        └── skill.py
  └── env/bridge.py ──── HTTP ────────► Mineflayer bot
```

**Python** is the brain: it decides what to do next (CurriculumAgent), generates the JavaScript code to do it (ActionAgent), judges whether it succeeded (CriticAgent), and stores reusable skills (SkillManager).

**Node.js** is the body: it runs the Mineflayer bot, executes the JS code Python sends, and returns observations. It also runs the reactive layer independently of any Python call.

---

## Dual-Layer Architecture

The key architectural addition of Phase 1 is the **reactive layer** — a second independent system running inside Node.js alongside the strategic layer.

```
Python (strategic, ~1-10s per decision)    Node.js (always running)
────────────────────────────────────       ───────────────────────────────────────
CurriculumAgent                            Reactive Rules Engine
  proposes next task ──────────────────►   ├── Priority 0 — CRITICAL (event-driven)
                                           │     on fire, in lava, in void
ActionAgent                                │     → immediate evasion, no polling
  generates JS code ─────── /step ──────►  ├── Priority 1 — HIGH (200ms poll)
                                           │     health ≤ 3 hearts, drowning
                                           │     → abort current action
                         ◄─ observations ─ ├── Priority 2 — MEDIUM (500ms poll)
                                           │     hunger ≤ 4, hostile mob ≤ 6 blocks
                                           │     → finish current atomic op, then act
CriticAgent                                └── Priority 3 — LOW (2000ms poll)
  verifies success ◄── recentReactiveEvents     hunger ≤ 8, mob ≤ 15 blocks
                                                → inform only, no interruption
```

**Communication pattern:** Node.js reacts autonomously. Python does not get notified in real time. Instead, every `/step` response includes `recentReactiveEvents` — an append-only log of what the reactive layer did since the last step. Python reads this at the start of each planning cycle.

---

## Observation Space

Every `/step` response returns a JSON array of `[event_type, data]` pairs. The final entry is always `["observe", {...}]`, which contains the full state snapshot:

| Field | Source | Description |
|---|---|---|
| `status.health` | `bot.health` | Current health (0–20) |
| `status.food` | `bot.food` | Current hunger (0–20) |
| `status.isOnFire` | `bot.entity.onFire` | Boolean — on fire |
| `status.isDaytime` | `bot.time.timeOfDay < 13000` | Boolean — before sunset |
| `status.timeOfDay` | `bot.time.timeOfDay` | Readable string: "day", "night", etc. |
| `status.position` | `bot.entity.position` | `{x, y, z}` |
| `status.entities` | `bot.entities` | Nearby mobs within 32 blocks: `{name: distance}` |
| `status.biome` | `bot.blockAt(pos).biome.name` | Current biome name |
| `status.equipment` | `bot.inventory.slots` | Equipped items (armor + hands) |
| `voxels` | block scan | Blocks immediately surrounding the bot |
| `inventory` | `bot.inventory` | Full inventory as `{item_name: count}` |
| `nearbyPlayers` | `bot.players` | Nearby human players: `[{username, distance, position}]` |
| `nearbyChests` | chest memory | Known chest contents |
| `blockRecords` | accumulated scan | All block types seen this step |
| `recentReactiveEvents` | reactive engine | Events fired by the reactive layer this step |

---

## Reset Modes

| Mode | Behavior | Use case |
|---|---|---|
| `"hard"` | `/clear @s` + `/kill @s` + reconnect | Fresh session start, Creative testing |
| `"soft"` | Disconnect + reconnect; inventory preserved | Error recovery |
| `"none"` | No disconnect (planned) | Normal task transitions in survival |

Set via `reset_mode` parameter in `Voyager.__init__()`. Controls what `bridge.py` sends to the `/start` endpoint as `req.body.reset`.

---

## Survival Override

When `GAME_MODE=survival` in `.env`, `voyager.py` runs a deterministic pre-filter **before** asking the CurriculumAgent for the next task:

```
On fire?          → "Find water to extinguish the fire"
health < 6?       → "Eat food or find safety to restore health"
food < 6?         → "Find and eat food immediately"
otherwise         → CurriculumAgent.propose_next_task()
```

This requires no LLM call and guarantees the bot never ignores a critical survival state regardless of what the LLM would otherwise suggest. Implemented in `voyager.py::_propose_next_task()`.

---

## Agent Prompts

All agent prompts are plain-text templates in `voyager/prompts/`. They are loaded at runtime — editing them changes LLM behavior without touching Python code.

| File | Used by | Purpose |
|---|---|---|
| `curriculum.txt` | CurriculumAgent | System prompt — what task to propose next |
| `action_template.txt` | ActionAgent | System prompt — how to generate JS code |
| `critic.txt` | CriticAgent | System prompt — how to evaluate task success |

The human message (the actual observation data sent per step) is assembled in `curriculum.py::render_human_message()` and `action.py::render_human_message()`.

---

## Python/Node.js File Map

```
Python side                              Node.js side
───────────────────────────────          ──────────────────────────────────────
voyager/voyager.py                       voyager/env/mineflayer/index.js
  └── learn() — main loop                 └── /start, /step, /pause endpoints

voyager/env/bridge.py                    voyager/env/mineflayer/lib/
  └── VoyagerEnv — gym.Env wrapper          ├── reactive/
        ├── reset() → POST /start           │    ├── index.js   — engine entry point
        └── step()  → POST /step            │    ├── priorities.js
                                            │    ├── rules.js   — rule definitions
voyager/agents/curriculum.py              │    └── actions.js — emergency actions
  └── propose_next_task()                  └── observation/
        └── render_human_message()              ├── status.js      — health, food, etc.
                                                ├── players.js     — nearbyPlayers
voyager/agents/action.py                        ├── inventory.js
  └── render_human_message()                    ├── reactive_events.js
                                                ├── voxels.js
voyager/agents/critic.py                        ├── chests.js
voyager/agents/skill.py                         └── ...
```
