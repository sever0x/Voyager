# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Voyager is an LLM-powered embodied lifelong learning agent for Minecraft. It uses GPT-4 to control a Mineflayer bot that autonomously explores, learns reusable JavaScript skills, and completes tasks through iterative prompting. See the paper: arXiv:2305.16291.

## Setup

### Prerequisites

- Python 3.9
- Node.js ≥ 16.13.0
- OpenAI API key with GPT-4 access
- Minecraft 1.19 with Fabric loader 0.14.18 (see `installation/` for details)
- **Windows only**: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload — required to compile `hnswlib` and `greenlet`. Without this, `pip install -e .` will fail.

### Python (use a virtual environment)

```bash
python -m venv venv

# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -e .
pip install python-dotenv
```

### Node.js (Mineflayer bot server)

`mineflayer-collectblock` is a local `file:` dependency, so it must be compiled before the parent `npm install` picks it up:

```bash
cd voyager/env/mineflayer/mineflayer-collectblock
npm install
npx tsc
cd ..
npm install
```

To verify the server starts correctly before running the full system:

```bash
node index.js 3000
# Expected output: "Server started on port 3000"
# Then Ctrl+C
```

### Minecraft

Two options to get the `mc_port`:

**Option A — any launcher (PrismLauncher, TLauncher, etc.)**
1. Launch Minecraft 1.19 with Fabric loader 0.14.18 and required mods installed (see `installation/fabric_mods_install.md`)
2. Create a world: Game Mode **Creative**, Difficulty **Peaceful**
3. `Esc` → **Open to LAN** → Allow Cheats: ON → **Start LAN World**
4. Note the port number shown in chat — that is your `MC_PORT`

**Option B — Azure login (auto-resume on timeout)**
See `installation/minecraft_instance_install.md`.

## Running

Copy `.env` (already in `.gitignore`) and fill in your values:

```
MC_PORT=XXXXX
OPENAI_API_KEY=sk-...
```

Then run:

```bash
python run.py
```

`run.py` loads these values automatically via `python-dotenv`.

For inference from a pre-built skill library:

```python
from voyager import Voyager

voyager = Voyager(skill_library_dir="./skill_library/trial1", ckpt_dir="...", resume=True)
voyager.inference(sub_goals=voyager.decompose_task("Craft a diamond pickaxe"))
```

There is no formal test suite. Manual testing happens by running the agent against a live Minecraft instance.

### Expected runtime behaviour

- **"bot left game" / "bot connected to the game"** appearing repeatedly is normal. Between tasks, `env.reset()` stops and restarts the Mineflayer bot to hard-reset the bot's state (clear inventory, respawn). This is by design.
- LangChain deprecation warnings about `ChatOpenAI` and `OpenAIEmbeddings` are no longer expected — the project was migrated to `langchain==0.3.30` with `langchain-openai` and `langchain-chroma` packages.

## Architecture

The system has two runtimes:

**Python** — orchestrates agents and manages state  
**Node.js** — runs the Mineflayer bot as an HTTP server (`localhost:3000`)

Python communicates with Node.js through HTTP (via `voyager/env/bridge.py`), sending code strings to `/step` and receiving observations back.

### Agent Components (`voyager/agents/`)

| Agent | Role |
|---|---|
| `ActionAgent` | Generates and iteratively refines executable JavaScript via gpt-5.4-mini; retrieves relevant skills from the skill library before each step |
| `CurriculumAgent` | Proposes the next task using gpt-5.4-mini, uses gpt-5.4-nano for Q&A context; caches results in Chroma vectordb |
| `CriticAgent` | Verifies whether a task was completed by analyzing final environment state via gpt-5.4-mini |
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
- **Cost split**: `gpt-5.4-mini` for action generation, critic, and curriculum proposal; `gpt-5.4-nano` for simpler Q&A in `CurriculumAgent` and skill descriptions. All models are configurable via `.env` — see `.env.example`.
- **`chromadb==1.5.9` is pinned** in `requirements.txt`. Auto-persists on every write — no explicit `.persist()` calls needed. Vectordb dirs (`ckpt/*/vectordb/`) must be deleted when switching embedding models.
- **`prismarine-block` version is pinned** in `package.json` — a newer version was incompatible with the bot logic.
- **Max retries**: `ActionAgent` retries code generation up to `action_agent_task_max_retries` times per task, incorporating error output and critic feedback into subsequent prompts.