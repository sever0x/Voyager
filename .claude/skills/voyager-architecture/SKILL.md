---
name: voyager-architecture
description: Deep architectural reference for the Voyager project (LLM-powered Minecraft agent). Use this skill whenever someone asks how Voyager works internally, how its components interact, what the data flow is, how to migrate or refactor the system, what dependencies are pinned and why, or any question about how Python and Node.js sides communicate. Also trigger when asked about agent loop internals, checkpoint layout, observation system, skill library mechanics, or any "where is X defined / how does X work" question in this codebase.
---

# Voyager Architecture Reference

Voyager is an LLM-powered autonomous Minecraft agent. It orchestrates four GPT-backed agents across two runtimes (Python + Node.js) to continuously propose, execute, verify, and memorize Minecraft tasks.

## Two-Runtime Overview

```
Python process                           Node.js process
────────────────────────────             ─────────────────────────
Voyager (orchestrator)                   Express HTTP server :3000
  ├── VoyagerEnv (gym.Env)  ──POST──►   /start  (spawn bot)
  │     └── SubprocessMonitor            /step   (run JS code)
  ├── ActionAgent  (gpt-5.4-mini)        /pause  (toggle freeze)
  ├── CurriculumAgent (gpt-5.4-mini)     /stop   (disconnect)
  ├── CriticAgent  (gpt-5.4-mini) ◄─JSON── observations
  ├── SkillManager (gpt-5.4-nano)
  └── EventRecorder
```

Python communicates with Node.js **only through HTTP**. The Minecraft game server is a separate process; Node.js connects to it as a Mineflayer client.

## Component Details

See the reference files in `references/` for full component-level detail:

- `references/python-side.md` — Voyager class, all four agents, VoyagerEnv, utilities
- `references/nodejs-side.md` — Express server, observation system, skill loader, plugins

## The Autonomous Learning Loop

`Voyager.learn()` runs continuously until `max_iterations` is reached:

```
Before loop: env.reset("hard")   ← one-time at session start; clears inventory
             self.last_events = env.step("")  ← initial observation

1. (inside rollout) env.reset("soft")
      └─ HTTP /start → Node.js spawns bot → returns initial observation JSON
      Note: hard reset only recurs on exception recovery inside the loop

2. CurriculumAgent.propose_next_task(last_events, chest_obs)
      ├─ first task hardcoded: "Mine 1 wood log"
      ├─ if inventoryUsed >= 33 → hardcode deposit/chest task
      └─ else → GPT-4 proposes next task

3. rollout(task, context)
      a. reset(task, context):
            ├─ env.reset("soft") → /start (bot restarts)
            ├─ SkillManager.retrieve_skills(context) → ChromaDB top-k JS codes
            ├─ ActionAgent.render_system_message(skills) → system prompt
            └─ ActionAgent.render_human_message(events) → observation prompt

      b. step() loop (max action_agent_task_max_retries = 4 times):
            ├─ ActionAgent.llm([system, human]) → GPT-4 → JS code block
            ├─ ActionAgent.process_ai_message() → Babel AST parse → {program_code, exec_code}
            ├─ env.step(code, programs) → HTTP /step → eval() → observations
            ├─ EventRecorder.record(events, task) → ckpt/events/
            ├─ ActionAgent.update_chest_memory(nearbyChests)
            ├─ CriticAgent.check_task_success() → GPT-4 → {success, critique}
            ├─ if failed + reset_placed_if_failed: env.step(givePlacedItemBack(...))
            └─ re-render messages with new events + critique → next iteration

4. if success:
      SkillManager.add_new_skill(info)
            ├─ GPT-3.5 generates description
            ├─ add to ChromaDB (id = function name)
            └─ write .js + .txt + skills.json (vectordb auto-persists)

5. CurriculumAgent.update_exploration_progress(info)
      └─ persist completed_tasks.json + failed_tasks.json
```

## Checkpoint Layout

```
ckpt/
├── action/
│   └── chest_memory.json          # {position: {item: count} | "Unknown" | "Invalid"}
├── curriculum/
│   ├── completed_tasks.json
│   ├── failed_tasks.json
│   ├── qa_cache.json              # {question: answer}
│   └── vectordb/                  # ChromaDB: QA question embeddings
├── skill/
│   ├── code/                      # *.js — raw skill function files
│   │                              # versioned: nameV2.js, nameV3.js on overwrite
│   ├── description/               # *.txt — LLM-generated descriptions
│   ├── skills.json                # {name: {code, description}}
│   └── vectordb/                  # ChromaDB: skill description embeddings
└── events/
    └── taskname_YYYYMMDD_HHMMSS   # JSON event log per step
```

**Critical invariant**: `vectordb._collection.count()` must equal `len(skills.json)`. Checked at startup — mismatch causes RuntimeError. If migrating, transfer both artifacts together or delete vectordb and rebuild from skills.json.

## Pinned Dependencies (Do Not Upgrade Without Testing)

| Dependency | Pinned version | Why |
|---|---|---|
| `chromadb` | `1.5.9` | Auto-persists on write; `_collection.count()` API used at startup for integrity check |
| `prismarine-block` | `=1.16.3` | Newer versions break Mineflayer bot logic |
| `langchain` | `1.2.17` | Uses `langchain_openai.ChatOpenAI` / `langchain_chroma`; requires Python ≥ 3.13 |
| `python-dotenv` | `1.2.1` | Used by `run.py` for `.env` loading |

**Import paths (post-migration)**: `from langchain_openai import ChatOpenAI, OpenAIEmbeddings` and `from langchain_chroma import Chroma`. The old `langchain.chat_models` / `langchain.embeddings.openai` paths no longer exist.

## Key Non-Obvious Details

**Python→Node.js JS parsing via `javascript` package**: `ActionAgent.process_ai_message()` uses the PyPI `javascript` package to spin up an embedded Node.js runtime and call `@babel/core` from Python. This means the Python process needs Node.js on PATH and `node_modules/@babel/core` installed in the mineflayer directory.

**Dual control_primitives directories**:
- `voyager/control_primitives/` — JS code actually executed by the bot at runtime
- `voyager/control_primitives_context/` — simplified/annotated versions the LLM sees as API documentation

These are different files. Both must be migrated.

**eval() code execution**: Node.js runs LLM-generated JS via `eval("(async () => {" + programs + "\n" + code + "})()")`. `programs` = all skill code + all control primitives, concatenated. Error line numbers are adjusted by subtracting `programs.split("\n").length`.

**Bot restarts on every reset**: `mineflayer.stop()` + full reconnect on every `env.reset()`. This is intentional — hard isolation between tasks. The "bot left game / bot connected" log spam is by design.

**Skill versioning**: On repeated success with the same function name, the old `.js` file is versioned (V2, V3…) on disk, but the ChromaDB entry is overwritten (same id). Only the latest description is retrievable.

**returnItems()**: After every `/step`, Node.js auto-recovers crafting_table and furnace from the world (via `/setblock air destroy` + `/give`). This prevents losing key items during crafting.

**Pause mechanism**: Python calls `env.pause()` after each step. This sends `/pause` to Minecraft chat, freezing game physics. `env.unpause()` resumes. Gives Python full control over bot lifecycle between steps.

**onSave events**: Skill code can call `bot.save("event_name")` to emit named events. ActionAgent watches for `event["onSave"].endswith("_placed")` to revert block placements when `reset_placed_if_failed=True`.

**ChromaDB QA cache**: Similarity search with L2 threshold `< 0.05` = cache hit. Prevents redundant OpenAI calls for repeated questions about the same biome/context.

**Model split**: `gpt-5.4-mini` for ActionAgent, CurriculumAgent (task proposal), and CriticAgent; `gpt-5.4-nano` for CurriculumAgent QA and SkillManager description generation — simpler tasks, lower cost. All models are configurable via `.env` (`ACTION_MODEL`, `CURRICULUM_MODEL`, `CURRICULUM_QA_MODEL`, `CRITIC_MODEL`, `SKILL_MODEL`, `EMBEDDING_MODEL`).

**Advanced primitives flag**: `action_agent_include_advanced_primitives` (env var `ACTION_ADVANCED_PRIMITIVES`, default `true`) controls whether `useChest` and `mineflayer` primitives are included in the ActionAgent system prompt. Set to `false` when using smaller/weaker models that struggle with complex tool use.

**Warm-up system**: CurriculumAgent has a `warm_up` dict controlling when each observation field appears in the prompt. For example, `context` (QA answers) only appear after 15 completed tasks. Fields with threshold > 0 are included with 80% probability (random dropout for diversity).
