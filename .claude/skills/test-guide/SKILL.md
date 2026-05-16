---
name: test-guide
description: Generate a detailed, step-by-step in-game Minecraft testing guide after implementing any Voyager or Voyager Buddy feature. Trigger this skill immediately after completing any implementation task in the Voyager codebase — Phase 1, Phase 2, reactive layer rules, observation space changes, reset modes, chat commands, skill library changes, survival memory, prompts, control primitives, or any Node.js / Python behavior change. The guide must be detailed enough for the developer to run through from scratch without consulting any other documentation.
---

# In-Game Test Guide Generator

After implementing a feature, produce a structured testing guide that lets a developer verify the change works in a real Minecraft session. The guide must be concrete and self-contained — no "see docs for details", no generic advice.

## Step 1 — Understand what changed

Before writing the guide, read the changed files and the conversation context to determine:

1. **What layer changed** — Node.js reactive (`lib/reactive/`), observation (`lib/observation/`), Python agents/prompts, or both
2. **What the observable signal is** — what exactly happens in-game when the feature works correctly
3. **What game mode / setup it requires** — Creative vs. Survival, Peaceful vs. Normal, player proximity, cheats ON/OFF
4. **What output channel carries the proof** — Python console, Minecraft chat, in-game visuals, `ckpt/` files

If the answer to any of these is unclear, state the assumption explicitly in the guide.

---

## Step 2 — Write the guide

Use this fixed section structure every time.

---

### Section 1: Prerequisites

State exact requirements before touching Minecraft:

- **Minecraft version**: 1.19 with Fabric loader 0.14.18 and required mods (from `installation/fabric_mods_install.md`)
- **Game mode**: Creative / Survival — and *why* it matters for this feature
- **Difficulty**: Peaceful / Easy / Normal / Hard — and *why* (mob spawning, hunger drain, damage)
- **Cheats**: ON or OFF — list every `/command` used in the test that requires cheats
- **`.env` values to set**: list only the ones relevant to this feature (`GAME_MODE`, `MC_PORT`, any feature flag)

---

### Section 2: Start the session

Exact commands from scratch. Always include these, even if the developer knows them — copy-pasteable is the goal.

```
1. Launch Minecraft 1.19 (Fabric 0.14.18) with required mods installed
2. Open or create a world with the settings from Section 1
3. Esc → Open to LAN → Allow Cheats: ON → Start LAN World
4. Note the port number shown in chat → set MC_PORT=<port> in .env
5. Activate venv:
     Windows:  venv\Scripts\activate
     macOS/Linux: source venv/bin/activate
6. Run: python run.py
7. Wait for "Server started on port 3000" in the terminal, then for the bot to join (watch game chat)
```

If `GAME_MODE=survival` is required, add this step:
```
8. Confirm the bot spawns in Survival mode — open inventory (E) and check the bot's game mode via F3 debug screen
```

---

### Section 3: Test steps

A numbered QA checklist. Each step must be answerable with yes/no.

Format every step as:
> **N. [Action]** — [Expected result] *(where to look)*

Examples of what "action" means depending on the feature:
- Walking your player near the bot
- Typing a command in Minecraft chat
- Running `/effect give @s minecraft:hunger 60 5` to force hunger drain
- Running `/summon zombie ~ ~ ~` near the bot
- Running `/time set night` to trigger nighttime logic
- Waiting N seconds for a reactive rule to fire
- Running `/kill` to trigger death handling
- Examining a `ckpt/` file after an event

Examples of what "where to look" means:
- "Python console — observation dict printed by `ActionAgent`"
- "Minecraft chat — bot broadcasts a message"
- "In-game — watch bot movement"
- "`ckpt/survival/experiences.json` — new entry appended"
- "`recentReactiveEvents` array in the observation dict"

---

### Section 4: Edge cases

List 2–4 edge cases specific to this feature. Think about:
- What happens if the trigger condition fires twice in a row?
- What if the bot is mid-task when the reactive rule fires?
- What if the required item is missing from inventory?
- What if the player is at the edge of detection range?
- What if the feature is in Creative mode vs. Survival mode?
- What if the `.env` flag is toggled while the bot is running?

For each edge case, state: condition → expected behavior.

---

### Section 5: Reading the output

Tell the developer exactly where to look and what to search for.

**Python console:**
- The observation dict is printed inside `ActionAgent.render_human_message()`. Search the terminal for the field name (e.g., `"nearbyPlayers"`, `"isOnFire"`, `"recentReactiveEvents"`).
- Critic feedback is printed after each task attempt — look for `"success"` / `"critique"` lines.
- Errors from Node.js arrive as `{"error": "..."}` in the observation.

**Minecraft chat:**
- The bot sends `/pause` to freeze the game between steps — this appears as a chat message. Normal behavior.
- Any bot speech (chat commands in Phase 2) appears here.
- "bot left game" / "bot connected to the game" appearing repeatedly is normal during resets.

**In-game visuals:**
- Bot movement, block placement, item consumption, mob combat — watch the bot character directly.
- Press F3 to see coordinates if verifying position-based behavior (e.g., home.json location).

**`ckpt/` files (state after the test):**
- `ckpt/action/chest_memory.json` — chest contents observed by bot
- `ckpt/curriculum/completed_tasks.json` — tasks marked done
- `ckpt/skill/code/` — new `.js` files saved after successful skill learning
- `ckpt/survival/experiences.json` — events recorded by `SurvivalMemory`
- `ckpt/survival/home.json` — home position set by bot or player command

---

### Section 6: Reset and cleanup

What to do between runs to get back to a clean state.

- **Between test iterations**: the agent calls `env.reset("hard")` automatically at session start — restarting `python run.py` is enough
- **Manual hard reset without restarting**: `/clear @s` then `/kill @s` while the bot is in game
- **Deleting checkpoints**: delete `ckpt/skill/vectordb/` AND `ckpt/skill/skills.json` together if resetting skill state — deleting only one breaks the integrity check at startup
- **Resetting survival state**: delete `ckpt/survival/` entirely

---

## Feature-specific patterns

Match the implementation to a category and fold in the relevant details.

### Reactive layer rules (`lib/reactive/rules.js`, `lib/reactive/actions.js`)

**Critical**: reactive rules only fire in Survival mode. Creative mode skips all priority-0 through priority-2 checks.

| Priority | Trigger | How to force it in-game |
|---|---|---|
| 0 — CRITICAL | Bot catches fire | `/effect give @s minecraft:fire_resistance 0 0 true` to remove resistance, then stand in lava — or: `/execute as <bot_name> run effect give @s minecraft:fire_resistance 0 1` after teleporting bot near fire |
| 1 — HIGH | Health ≤ 3 hearts | `/damage @s 14` (requires cheats, Minecraft 1.19+) |
| 2 — MEDIUM | Hunger ≤ 4 bars | `/effect give @s minecraft:hunger 60 5` |
| 2 — MEDIUM | Hostile mob ≤ 6 blocks | `/summon zombie ~ ~ ~` next to bot |
| 3 — LOW | Hunger ≤ 8 bars | `/effect give @s minecraft:hunger 30 2` |
| 3 — LOW | Hostile mob ≤ 15 blocks | `/summon zombie ~10 ~ ~10` (10 blocks away) |

To verify the reactive event fired: look for it in `recentReactiveEvents` in the Python console observation dict on the next step. The reactive layer runs every 500 ms, so the event should appear within 1–2 seconds of the trigger.

### Fight/flee logic

Multi-factor decision — verify each branch separately:

| Condition | Expected behavior |
|---|---|
| health < 8 | Flee unconditionally (sprint away from mob centroid) |
| creeper + distance < 5 | Flee immediately |
| no weapon equipped | Flee + attempt to equip from inventory |
| weapon equipped + health ≥ 8 | Engage (killMob) |

Flee pattern: sprint ~10–15 blocks away from mob cluster centroid. If still pursued: `pillarUp(4–5 blocks)`. If home is within 50 blocks: sprint toward home.
Verify: watch bot movement in-game and check `recentReactiveEvents`.

### `pillarUp` control primitive

Place cobblestone (or dirt if no cobblestone) in inventory before test.
Trigger flee scenario so `pillarUp` fires as secondary escalation.
Expected: bot places N blocks straight up underneath itself.
Verify: a 4–5 block pillar of cobblestone/dirt appears at the bot's previous position.

### Observation space changes (new fields in `lib/observation/*.js`)

The field must appear in the observation dict printed to the Python console. The path is: `events[-1][1]["<fieldName>"]`.

To force the condition that makes the field non-empty, perform the relevant in-game action, then let the agent complete one step (one `/step` call). The next printed observation dict should contain the field.

If the field only appears conditionally: force the condition, then verify the field appears. Then remove the condition and verify the field is absent (or returns to its zero/empty state).

### Player observation (`lib/observation/players.js`, `nearbyPlayers`)

Walk your player character within 32 blocks of the bot.
Expected in console: `"nearbyPlayers": [{"username": "<your_name>", "distance": <N>, ...}]`
Move beyond 32 blocks — field should become empty array.
Verify both directions.

### Reset modes

Test each mode explicitly. Between each test, note the inventory contents and then check after reset.

| Mode | Behavior to verify |
|---|---|
| `"hard"` | Bot disconnects + reconnects. Inventory cleared (`/clear @s`). Bot killed and respawned (`/kill @s`). |
| `"soft"` | Bot disconnects + reconnects. Inventory preserved. |
| `"none"` | Bot stays connected. No inventory change. No kill. |

In `run.py` / Voyager constructor, temporarily set `reset_mode="hard"` / `"soft"` / `"none"` to test each branch.
Watch game chat for "bot left game" / "bot connected" (should appear for hard/soft, not for none).

### Skills and `SkillManager`

Run the agent through a complete task.
After success: check `ckpt/skill/code/<functionName>.js` exists.
Check `ckpt/skill/description/<functionName>.txt` exists.
Check `ckpt/skill/skills.json` contains an entry with the function name.
Verify `ckpt/skill/vectordb/` was updated (modified timestamp changed).

If the same function name is relearned: old file should be versioned to `<name>V2.js`, new file at `<name>.js`.

### Chat commands (`lib/chat.js`, `recentChatCommands`)

Type each supported command in Minecraft chat while standing near the bot.
Supported commands (Phase 2): `come`, `stop`, `follow me`, `stay`, `go home`, `set home here`, `what are you doing`, `inventory`, `give me [item]`, `craft [item]`.

Expected: command appears in `recentChatCommands` in the next observation dict (Python console).
Expected: bot behavior changes according to the command.
Test unrecognized input — should be ignored (no crash, no bot response).

### Survival memory (`agents/survival_memory.py`, `ckpt/survival/experiences.json`)

Trigger a death: type `/kill` in game chat while cheats are ON.
Expected: `ckpt/survival/experiences.json` gets a new entry with `"event": "death"` and a generated `"lesson"` string.

Trigger a shelter success: let the bot complete a shelter-building task.
Expected: `ckpt/survival/experiences.json` gets a new entry with `"event": "shelter_built"`.

Verify lessons feed into curriculum: run one more task cycle and check the Python console for "Recent survival experiences" in the CurriculumAgent prompt.

### Home concept (`ckpt/survival/home.json`)

After bot completes shelter: check `ckpt/survival/home.json` for `{"position": {...}, "set_by": "bot"}`.
Type `set home here` in chat: check the file updates to `"set_by": "player"`.
Confirm player-set home takes permanent precedence: trigger a bot shelter-build, verify the file still shows `"set_by": "player"`.

### Prompts and observation text

The prompts are loaded at runtime, so changes take effect on the next `python run.py` without recompile.
To verify the text reaches the LLM: add a temporary `print()` inside `ActionAgent.render_human_message()` or `CurriculumAgent.render_observation()` and confirm the new field/line appears before removing the print.
Alternatively: watch the console carefully — ActionAgent logs the full prompt at INFO level on each step.

### `isSheltered` detection (`lib/observation/shelter.js`)

Condition: solid block directly above + ≥ 3 of 4 horizontal neighbors solid + ≥ 1 light source within 5 blocks.

Test cases:
1. Bot in open air → `isSheltered: false`
2. Bot inside a wooden box with a torch → `isSheltered: true`
3. Bot under a single block ceiling with no walls → `isSheltered: false` (walls missing)
4. Bot inside a room, no torch → `isSheltered: false` (no light source)

Use `/setblock` to build test enclosures quickly if cheats are ON.

---

## Tone and format rules

- Numbered steps, not prose — each step must be one action with one expected result
- Exact commands in backticks — `/effect give @s minecraft:hunger 60 5`, not "give hunger effect"
- Flag every command that requires cheats with: *(requires Allow Cheats: ON)*
- If a step involves waiting, give the approximate time: "wait ~2 seconds for the reactive loop to fire"
- Do not reference other documents — if it matters, inline it
- State assumptions explicitly if the game state before a step is ambiguous
