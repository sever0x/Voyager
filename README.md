# Voyager Buddy — Minecraft Survival Co-op Companion

> Forked from [Voyager](https://github.com/MineDojo/Voyager) by Wang et al. (arXiv:2305.16291).

A Minecraft agent that plays Survival alongside a real player — exploring, building, crafting, and fighting together toward defeating the Ender Dragon. Built on top of Voyager's LLM-driven skill system and extended with a reactive survival layer, persistent session state, and cooperative logic.

[![Python Version](https://img.shields.io/badge/Python-3.13-blue.svg)](https://github.com/sever0x/Voyager)
[![GitHub license](https://img.shields.io/github/license/sever0x/Voyager)](https://github.com/sever0x/Voyager/blob/main/LICENSE)

<div align="center">

https://github.com/sever0x/Voyager/assets/25460983/ce29f45b-43a5-4399-8fd8-5dd105fd64f2

</div>

---

## Vision

The buddy should feel like a capable teammate, not a scripted NPC. It keeps itself alive through Minecraft nights, manages its own food and gear, responds to player chat, contributes meaningfully to shared goals, and grows its skill library over time.

See [ROADMAP.md](ROADMAP.md) for the full six-phase development plan.

**Current status: Phase 1 — Architectural Foundations** (dual-layer reactive/strategic architecture, persistent session state, survival mode support).

---

## Architecture

Two runtimes communicate over HTTP:

**Python** — orchestrates LLM agents and manages state  
**Node.js** — runs the Mineflayer bot as an HTTP server (`localhost:3000`)

```
Node.js (always running)
├── Reactive layer  — rules engine, <50ms response (eat, flee, dodge)
└── Goal executor   — pursues current strategic goal from Python

Python (async)
└── Strategic layer — LLM-driven planning, chat, skill library
```

See [CLAUDE.md](CLAUDE.md) for a full component breakdown.

---

## Installation

### Prerequisites

- Python 3.13
- Node.js ≥ 16.13.0
- OpenAI API key
- Minecraft 1.19 with Fabric loader 0.14.18 and required mods (see `installation/fabric_mods_install.md`)
- **Windows only**: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload — required to compile `hnswlib` and `greenlet`

### Step 1 — Python environment

```bash
python -m venv venv

# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -e .
pip install python-dotenv
```

### Step 2 — Node.js dependencies

`mineflayer-collectblock` is a local TypeScript plugin — compile it before the parent install:

```bash
cd voyager/env/mineflayer/mineflayer-collectblock
npm install
npx tsc
cd ..
npm install
```

To verify the server starts correctly:

```bash
node index.js 3000
# Expected: "Server started on port 3000"
# Press Ctrl+C to stop
```

### Step 3 — Minecraft

1. Launch Minecraft 1.19 with Fabric loader 0.14.18 and required mods installed
2. Create a world: Game Mode **Survival**, Difficulty **Normal**
3. `Esc` → **Open to LAN** → Allow Cheats: ON → **Start LAN World**
4. Note the port number shown in chat — that is your `MC_PORT`

### Step 4 — Environment variables

Create a `.env` file in the project root (already in `.gitignore`):

```
MC_PORT=XXXXX
OPENAI_API_KEY=sk-...

# Optional — override model defaults
ACTION_MODEL=gpt-5.4-mini
CURRICULUM_MODEL=gpt-5.4-mini
CURRICULUM_QA_MODEL=gpt-5.4-nano
CRITIC_MODEL=gpt-5.4-mini
SKILL_MODEL=gpt-5.4-nano
EMBEDDING_MODEL=text-embedding-3-small
```

See `.env.example` for the full list of options.

### Step 5 — Run

```bash
python run.py
```

---

## Usage

### Quickstart

```bash
python run.py
```

`run.py` reads all configuration from `.env` automatically.

### Manual instantiation

```python
from voyager import Voyager

voyager = Voyager(
    mc_port=YOUR_MC_PORT,
    openai_api_key="YOUR_API_KEY",
)
voyager.learn()
```

### Resume from a checkpoint

```python
voyager = Voyager(
    mc_port=YOUR_MC_PORT,
    openai_api_key="YOUR_API_KEY",
    ckpt_dir="YOUR_CKPT_DIR",
    resume=True,
)
```

### Run with a pre-built skill library

```python
voyager = Voyager(
    mc_port=YOUR_MC_PORT,
    openai_api_key="YOUR_API_KEY",
    skill_library_dir="./skill_library/trial1",
    ckpt_dir="YOUR_CKPT_DIR",
    resume=False,
)
sub_goals = voyager.decompose_task("Craft a diamond pickaxe")
voyager.inference(sub_goals=sub_goals)
```

---

## Expected Runtime Behaviour

- **"bot left game" / "bot connected to the game"** appearing repeatedly between tasks is normal in Creative/exploration mode. In survival sessions with `reset_mode=none`, this no longer happens between tasks.
- LangChain deprecation warnings are not expected — the project uses `langchain==1.2.17` with `langchain-openai` and `langchain-chroma`.

---

## Roadmap

Six phases from architectural foundations to Ender Dragon defeat:

| Phase | Goal | Status |
|---|---|---|
| 1 | Architectural Foundations (dual-layer, persistent state, survival mode) | In progress |
| 2 | Survival Core (hunger, shelter, mobs, basic chat) | Planned |
| 3 | Progression & Tech Tree (iron→netherite, Nether, enchanting, End prep) | Planned |
| 4 | Communication & Personality (NLP chat, proactive messages) | Planned |
| 5 | Cooperative Logic (shared goals, task division, player protection) | Planned |
| 6 | World Memory & End Game (Ender Dragon, persistent world model) | Planned |

See [ROADMAP.md](ROADMAP.md) for full technical detail on each phase.

---

## FAQ

See [FAQ.md](FAQ.md) for common questions.

---

## Origin

This project is a fork of [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://voyager.minedojo.org/) by Guanzhi Wang, Yuqi Xie, Yunfan Jiang, Ajay Mandlekar, Chaowei Xiao, Yuke Zhu, Linxi Fan, and Anima Anandkumar (arXiv:2305.16291). The original codebase, skill library format, and agent architecture are the foundation this project builds on. Original code is under [MIT License](LICENSE).
