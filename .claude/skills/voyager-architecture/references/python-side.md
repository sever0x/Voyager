# Python Side — Detailed Reference

## Entry Point

`run.py` loads `.env` (MC_PORT, OPENAI_API_KEY) via `python-dotenv`, then instantiates `Voyager`.

---

## Voyager (`voyager/voyager.py`)

Central orchestrator. Owns all agents and the environment.

**Constructor parameters of note:**
- `mc_port` / `azure_login` — mutually exclusive ways to connect to Minecraft
- `server_port=3000` — Node.js HTTP server port
- `env_wait_ticks=20` — how many game ticks to wait after each step (increase if chat log is missing events)
- `env_request_timeout=600` — seconds before Python aborts waiting for a /step response
- `action_agent_task_max_retries=4` — max step() iterations per task
- `reset_placed_if_failed=False` — whether to revert block placements on failure (useful for building tasks)
- `curriculum_agent_mode="auto"` — "manual" mode prompts the user via terminal for each task
- `critic_agent_mode="auto"` — "manual" mode prompts the user to confirm success
- `skill_library_dir=None` — if set, uses a pre-existing skill library from a different path; also forces `resume=True` for SkillManager
- `ckpt_dir="ckpt"` — checkpoint root

**Key state variables:**
- `self.messages` — always `[SystemMessage, HumanMessage]`, length == 2
- `self.conversations` — list of `(system_content, human_content, ai_content)` tuples for the current task
- `self.last_events` — events from the most recent env.step(), used to pass context to CurriculumAgent
- `self.action_agent_rollout_num_iter` — current iteration within the step() loop; -1 means reset() not called

**`reset(task, context, reset_env=True)`**:
- Resets `action_agent_rollout_num_iter = 0`
- Calls `env.reset(mode="soft")` which restarts the bot
- Runs one env.step with a time-set command to get the initial observation
- Calls `SkillManager.retrieve_skills(context)` to get relevant JS code
- Builds `[SystemMessage, HumanMessage]` for the first LLM call
- Returns `self.messages`

**`step()`** — one action iteration:
- Calls `ActionAgent.llm(messages)` → AIMessage
- If parsing succeeds (returns dict): runs env.step, records, checks critic, updates messages
- If parsing fails (returns str): records empty events, logs error, increments counter
- `done = (iter >= max_retries) or success`
- Returns `(messages, reward=0, done, info)`

**`inference(task, sub_goals, reset_mode, reset_env)`** — production mode with pre-built skills:
- Decomposes task if sub_goals not provided
- Iterates sub_goals using `curriculum_agent.progress` as index
- Does NOT call `skill_manager.add_new_skill()` — read-only skill library

---

## VoyagerEnv (`voyager/env/bridge.py`)

Inherits `gymnasium.Env`. HTTP client wrapper around the Node.js server.

**Initialization**:
- Immediately starts the Mineflayer subprocess via `SubprocessMonitor`
- If `azure_login`: creates `MinecraftInstance` (Azure-managed Minecraft)
- Sets `self.connected = False`, `self.has_reset = False`

**`reset(options)`**:
```python
reset_options = {
    "port": self.mc_port,
    "reset": "hard" | "soft",
    "inventory": {},          # only for hard reset
    "equipment": [],          # only for hard reset
    "spread": False,          # /spreadplayers to random location
    "waitTicks": 5,
    "position": None,
}
```
1. `unpause()` — ensure bot is unpaused
2. `mineflayer.stop()` + `time.sleep(1)`
3. `check_process()` → restarts mineflayer if needed → POST /start
4. Sets `reset_options["reset"] = "soft"` for all future resets in this session
5. Returns `json.loads(returned_data)` — initial observation list

**`step(code, programs)`**:
1. `check_process()` — auto-recover from crashes
2. `unpause()` → POST /pause
3. POST /step `{"code": code, "programs": programs}`
4. `pause()` → POST /pause
5. Returns `json.loads(returned_data)`

**`check_process()`**:
- If `mc_instance` not running → starts it, updates `mc_port`
- If `mineflayer` not running → restarts, waits for ready, POST /start
- Returns `/start` response if recovery happened

---

## SubprocessMonitor (`voyager/env/process_monitor.py`)

Manages any subprocess (Mineflayer or Minecraft).

- Uses `psutil.Popen` (not subprocess.Popen) for cross-platform process control
- Reads stdout line-by-line in a `threading.Thread`
- `self.ready_event = threading.Event()` — set when `ready_match` regex found
- `run()` starts thread, then blocks on `ready_event.wait()`
- `stop()` calls `process.terminate()` + `process.wait()`
- `is_running` property checks `process.is_running()` (psutil method)

**MinecraftInstance callbacks**:
- `callback_match = r"\[Server thread/INFO\]: bot left the game"` — triggers `stop_mineflayer()`
- `finished_callback = stop_mineflayer` — also stops mineflayer when Minecraft exits

---

## MinecraftInstance (`voyager/env/minecraft_launcher.py`)

Only used when `azure_login` is provided. Manages Minecraft client via Azure OAuth.

- First run: interactive OAuth flow, saves token to `voyager/env/config.json`
- Subsequent runs: loads saved token, generates launch command via `minecraft_launcher_lib`
- `ready_match = r"Started serving on (\d+)"` — extracts the LAN port
- Wraps its own `SubprocessMonitor`

---

## ActionAgent (`voyager/agents/action.py`)

**`render_system_message(skills)`**:
- Loads `prompts/action_template.txt` as `SystemMessagePromptTemplate`
- `base_skills`: `["exploreUntil", "mineBlock", "craftItem", "placeItem", "smeltItem", "killMob"]`
- Adds `["useChest", "mineflayer"]` only if NOT gpt-3.5-turbo
- Loads JS source from `control_primitives_context/` for each named skill
- Appends passed `skills` (retrieved JS code from SkillManager)
- `programs = "\n\n".join(loaded_primitives + skills)`

**`render_human_message(events, code, task, context, critique)`**:
Builds observation string in this order:
1. "Code from the last round: ..." (or "No code in the first round")
2. Execution errors (if `self.execution_error=True`)
3. Chat log (if `self.chat_log=True`)
4. Biome, Time, Nearby blocks, Nearby entities (sorted by distance), Health, Hunger, Position, Equipment
5. Inventory with used slot count (e.g. "Inventory (7/36): {...}")
6. Chests (skipped if task is a deposit task)
7. Task, Context, Critique

**`process_ai_message(message)`**:
```python
babel = require("@babel/core")           # via PyPI 'javascript' package
babel_generator = require("@babel/generator").default
code_pattern = re.compile(r"```(?:javascript|js)(.*?)```", re.DOTALL)
code = "\n".join(code_pattern.findall(message.content))
parsed = babel.parse(code)
# finds all FunctionDeclarations
# finds last AsyncFunctionDeclaration → main function
# validates: single param named "bot"
# returns {program_code, program_name, exec_code}
```
3 retries with `time.sleep(1)` on any exception. On final failure returns error string (not dict).

**`update_chest_memory(chests)`**:
- Updates `self.chest_memory` with `nearbyChests` observation
- `"Invalid"` value → removes entry from memory
- Persists to `ckpt/action/chest_memory.json`

**`render_chest_observation()`**:
Returns formatted string with chest contents, sorted: non-empty → empty → unknown.

**`summarize_chatlog(events)`**:
Filters `onChat` events for patterns like "I cannot make X because I need: Y" and "I need at least a X to mine Y" — extracts the missing resource string. Returns "I also need X, Y, Z." or empty string.

---

## CurriculumAgent (`voyager/agents/curriculum.py`)

**Warm-up defaults**:
```python
{
    "context": 15,        # QA answers appear after 15 completed tasks
    "biome": 10,
    "time": 15,
    "nearby_blocks": 0,   # always shown
    "other_blocks": 10,
    "nearby_entities": 5,
    "health": 15,
    "hunger": 15,
    "position": 0,        # always shown
    "equipment": 0,       # always shown
    "inventory": 0,       # always shown
    "optional_inventory_items": 7,  # show full inventory after 7 tasks
    "chests": 0,
    "completed_tasks": 0,
    "failed_tasks": 0,
}
```

`optional_inventory_items`: before reaching this threshold, inventory is filtered to only `core_inventory_items` (regex: `.*_log|.*_planks|stick|crafting_table|furnace|cobblestone|dirt|coal|.*_pickaxe|.*_sword|.*_axe`).

Fields with warm_up > 0 are randomly included with **80% probability** once threshold is reached (deliberate noise for curriculum diversity).

**Non-overridable fields**: regardless of what `warm_up` dict is passed, the constructor always forces `nearby_blocks=0`, `inventory=0`, `completed_tasks=0`, `failed_tasks=0` (hardcoded in `curriculum.py:86-89`). Passing custom values for these in the constructor has no effect.

**`run_qa_step1_ask_questions`**:
- Always asks 3 biome questions: "What are the blocks/items/mobs in [biome]?"
- Then asks GPT-3.5 to generate additional questions in format "Question N: ...\nConcept N: ..."
- Returns `(questions, concepts)` — concepts are biome/item names

**`run_qa_step2_answer_questions`**:
- Simple GPT-3.5 call: "Question: {question}" → answer
- Used both for QA caching and `get_task_context(task)`

**`get_task_context(task)`**:
Strips "ore"/"ores" from task to avoid the LLM recommending Fortune-enchanted tools. Caches result.

**`decompose_task(task, events)`**:
Three-message conversation: system (decomposition prompt) + observation + "Final task: {task}". GPT-4 returns JSON list. Parsed by `fix_and_parse_json`.

---

## CriticAgent (`voyager/agents/critic.py`)

**`check_task_success`** flow:
1. If any `onError` in events → `render_human_message` returns `None` → `ai_check_task_success` returns `(False, "")` immediately
2. Otherwise builds observation, calls GPT-4, parses `{"reasoning": ..., "success": true/false, "critique": ...}`
3. `fix_and_parse_json` handles common LLM JSON errors (trailing commas, etc.)
4. Up to `max_retries=5` recursive retries on parse failure

---

## SkillManager (`voyager/agents/skill.py`)

**`programs` property**:
```python
# all learned skills (code only, not description)
for skill_name, entry in self.skills.items():
    programs += f"{entry['code']}\n\n"
# all control primitives (full source)
for primitives in self.control_primitives:
    programs += f"{primitives}\n\n"
```
This string is passed as `programs` arg to `env.step()`.

**`generate_skill_description(program_name, program_code)`**:
GPT-3.5 returns a one-line description. Wrapped as:
```js
async function {program_name}(bot) {
    // {description}
}
```
This format is what gets added to vectordb — it makes the description searchable as a function signature.

**`add_new_skill` versioning**:
```python
if program_name in self.skills:
    self.vectordb._collection.delete(ids=[program_name])  # replace in db
    i = 2
    while f"{program_name}V{i}.js" in os.listdir(...):
        i += 1
    dumped_program_name = f"{program_name}V{i}"   # versioned file name
else:
    dumped_program_name = program_name
```

---

## Control Primitives

Two directories with parallel files:

| File | `control_primitives/` | `control_primitives_context/` |
|---|---|---|
| `mineBlock.js` | Full Mineflayer implementation | Simplified with JSDoc-style comments for LLM |
| `craftItem.js` | Full implementation | Simplified |
| `smeltItem.js` | Full implementation | Simplified |
| `killMob.js` | Full implementation | Simplified |
| `placeItem.js` | Full implementation | Simplified |
| `exploreUntil.js` | Full implementation | Simplified |
| `useChest.js` | Full implementation | Simplified |
| `shoot.js` | Full implementation | (not in context) |
| `craftHelper.js` | Full implementation | (not in context) |
| `givePlacedItemBack.js` | Full implementation — reverts block placements when `reset_placed_if_failed=True` | (not in context) |
| `waitForMobRemoved.js` | Full implementation | (not in context) |
| `mineflayer.js` | — | Mineflayer API overview for LLM |

**Loading**:
- `load_control_primitives()` → reads all `.js` from `control_primitives/` → returned as list of strings → concatenated into `SkillManager.programs`
- `load_control_primitives_context(names)` → reads named files from `control_primitives_context/` → used in ActionAgent system prompt

---

## Prompts (`voyager/prompts/`)

All plain text, loaded by `load_prompt(name)` which reads `prompts/{name}.txt`.

| File | Used by | Format |
|---|---|---|
| `action_template.txt` | ActionAgent system | Template with `{programs}` and `{response_format}` |
| `action_response_format.txt` | ActionAgent system | Injected into action_template |
| `curriculum.txt` | CurriculumAgent system | Task proposal criteria |
| `curriculum_qa_step1_ask_questions.txt` | QA step 1 system | Question generation format |
| `curriculum_qa_step2_answer_questions.txt` | QA step 2 system | Answer generation |
| `curriculum_task_decomposition.txt` | decompose_task system | Task decomposition format |
| `critic.txt` | CriticAgent system | Evaluation criteria + 7 few-shot examples |
| `skill.txt` | SkillManager system | Description generation rules |

---

## Utils

**`voyager/utils/json_utils.py`** — `fix_and_parse_json(s)`:
Attempts to repair and parse JSON strings that LLMs commonly malform (trailing commas, single quotes, etc.).

**`voyager/utils/record_utils.py`** — `EventRecorder`:
- `record(events, task)` — saves event list as JSON to `ckpt/events/{task}_{timestamp}.json`, increments `self.iteration`
- `resume()` — replays all saved event files to restore `item_history`, `item_vs_time`, `item_vs_iter`, `elapsed_time`, `position_history`
- Tracks: unique items ever collected, biomes visited, elapsed game ticks, XZ position history
- `iteration` counter is used by `Voyager.learn()` to check `max_iterations`
