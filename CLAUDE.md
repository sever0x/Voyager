# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Voyager is an LLM-powered embodied lifelong learning agent for Minecraft. It uses GPT-4 to control a Mineflayer bot that autonomously explores, learns reusable JavaScript skills, and completes tasks through iterative prompting. See the paper: arXiv:2305.16291.

## Setup

### Python
```bash
pip install -e .
```

### Node.js (Mineflayer bot server)
```bash
cd voyager/env/mineflayer
npm install
cd mineflayer-collectblock
npx tsc        # compile TypeScript plugin
cd ..
npm install
```

Minecraft also requires a running game instance (Azure login or direct port) and Fabric mods — see `installation/` for details.

## Running

```python
from voyager import Voyager

# Lifelong learning
voyager = Voyager(mc_port=25565, openai_api_key="...")
voyager.learn()

# Inference from a pre-built skill library
voyager = Voyager(skill_library_dir="./skill_library/trial1", ckpt_dir="...", resume=True)
voyager.inference(sub_goals=voyager.decompose_task("Craft a diamond pickaxe"))
```

There is no formal test suite. Manual testing happens by running the agent against a live Minecraft instance.

## Architecture

The system has two runtimes:

**Python** — orchestrates agents and manages state  
**Node.js** — runs the Mineflayer bot as an HTTP server (`localhost:3000`)

Python communicates with Node.js through HTTP (via `voyager/env/bridge.py`), sending code strings to `/step` and receiving observations back.

### Agent Components (`voyager/agents/`)

| Agent | Role |
|---|---|
| `ActionAgent` | Generates and iteratively refines executable JavaScript via GPT-4; retrieves relevant skills from the skill library before each step |
| `CurriculumAgent` | Proposes the next task using GPT-4, uses GPT-3.5-turbo for Q&A context; caches results in Chroma vectordb |
| `CriticAgent` | Verifies whether a task was completed by analyzing final environment state via GPT-4 |
| `SkillManager` | Stores learned JavaScript functions as named skills with LLM-generated descriptions; retrieves top-k relevant skills via Chroma + OpenAI embeddings |

### Environment (`voyager/env/`)

- `bridge.py` — Python-side `gym.Env` wrapper; spawns Mineflayer subprocess and Minecraft launcher
- `mineflayer/index.js` — Express.js server exposing `/start`, `/step`, `/pause`, `/stop`
- `mineflayer/mineflayer-collectblock/` — TypeScript plugin compiled to JS before use

### Control Primitives (`voyager/control_primitives/`)

JavaScript utility functions injected into the bot's context: `mineBlock`, `craftItem`, `smeltItem`, `killMob`, `useChest`, `placeItem`, `exploreUntil`, etc. These are the building blocks the ActionAgent's generated code calls.

### Prompts (`voyager/prompts/`)

Plain-text templates loaded at runtime and sent as system/human messages. Editing these directly changes LLM behavior without touching Python code.

### Checkpoint Layout

```
ckpt/
├── action/chest_memory.json
├── curriculum/
│   ├── completed_tasks.json
│   ├── failed_tasks.json
│   ├── qa_cache.json
│   └── vectordb/
└── skill/
    ├── code/       # *.js — raw skill functions
    ├── description/ # *.txt — LLM-generated descriptions
    ├── skills.json
    └── vectordb/
```

Pass `resume=True` to restart from an existing checkpoint directory.

## Key Design Decisions

- **Dual vectordb**: Chroma is used separately for skills (semantic code retrieval) and curriculum Q&A (caching task context). Both rely on OpenAI embeddings.
- **Cost split**: GPT-4 for action generation, critic, and curriculum proposal; GPT-3.5-turbo for simpler Q&A in `CurriculumAgent`.
- **`chromadb==0.3.29` is pinned** in `requirements.txt` — newer versions broke the API. Do not upgrade without testing.
- **`prismarine-block` version is pinned** in `package.json` — a newer version was incompatible with the bot logic.
- **Max retries**: `ActionAgent` retries code generation up to `action_agent_task_max_retries` times per task, incorporating error output and critic feedback into subsequent prompts.