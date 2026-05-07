# Voyager: An Open-Ended Embodied Agent with Large Language Models
<div align="center">

[[Website]](https://voyager.minedojo.org/)
[[Arxiv]](https://arxiv.org/abs/2305.16291)
[[PDF]](https://voyager.minedojo.org/assets/documents/voyager.pdf)
[[Tweet]](https://twitter.com/DrJimFan/status/1662115266933972993?s=20)

[![Python Version](https://img.shields.io/badge/Python-3.13-blue.svg)](https://github.com/MineDojo/Voyager)
[![GitHub license](https://img.shields.io/github/license/MineDojo/Voyager)](https://github.com/MineDojo/Voyager/blob/main/LICENSE)
______________________________________________________________________


https://github.com/MineDojo/Voyager/assets/25460983/ce29f45b-43a5-4399-8fd8-5dd105fd64f2

![](images/pull.png)


</div>

We introduce Voyager, the first LLM-powered embodied lifelong learning agent
in Minecraft that continuously explores the world, acquires diverse skills, and
makes novel discoveries without human intervention. Voyager consists of three
key components: 1) an automatic curriculum that maximizes exploration, 2) an
ever-growing skill library of executable code for storing and retrieving complex
behaviors, and 3) a new iterative prompting mechanism that incorporates environment
feedback, execution errors, and self-verification for program improvement.
Voyager interacts with GPT-4 via blackbox queries, which bypasses the need for
model parameter fine-tuning. The skills developed by Voyager are temporally
extended, interpretable, and compositional, which compounds the agent’s abilities
rapidly and alleviates catastrophic forgetting. Empirically, Voyager shows
strong in-context lifelong learning capability and exhibits exceptional proficiency
in playing Minecraft. It obtains 3.3× more unique items, travels 2.3× longer
distances, and unlocks key tech tree milestones up to 15.3× faster than prior SOTA.
Voyager is able to utilize the learned skill library in a new Minecraft world to
solve novel tasks from scratch, while other techniques struggle to generalize.

In this repo, we provide Voyager code. This codebase is under [MIT License](LICENSE).

# Installation
Voyager requires Python ≥ 3.13 and Node.js ≥ 16.13.0. We have tested on Ubuntu 20.04, Windows 11, and macOS. You need to follow the instructions below to install Voyager.

## Python Install
```bash
git clone https://github.com/MineDojo/Voyager
cd Voyager
python -m venv venv
# Windows: venv\Scripts\activate  /  macOS-Linux: source venv/bin/activate
pip install -e .
pip install python-dotenv
```

## Node.js Install
In addition to the Python dependencies, you need to install the following Node.js packages.
`mineflayer-collectblock` is a local TypeScript plugin and must be compiled **before** the parent `npm install`:
```bash
cd voyager/env/mineflayer/mineflayer-collectblock
npm install
npx tsc
cd ..
npm install
```

## Minecraft Instance Install

Voyager depends on Minecraft game. You need to install Minecraft game and set up a Minecraft instance.

Follow the instructions in [Minecraft Login Tutorial](installation/minecraft_instance_install.md) to set up your Minecraft Instance.

## Fabric Mods Install

You need to install fabric mods to support all the features in Voyager. Remember to use the correct Fabric version of all the mods. 

Follow the instructions in [Fabric Mods Install](installation/fabric_mods_install.md) to install the mods.

# Local Development Setup

This section covers the full setup process for developers running the project locally, including platform-specific requirements and verified steps.

## Prerequisites

- Python 3.13
- Node.js ≥ 16.13.0
- OpenAI API key
- Minecraft 1.19 with Fabric loader 0.14.18 and required mods (see `installation/fabric_mods_install.md`)
- **Windows only**: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload — required to compile `hnswlib` and `greenlet`. Without this, `pip install -e .` will fail.

## Step 1 — Python environment

Use a virtual environment to avoid dependency conflicts:

```bash
python -m venv venv

# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -e .
pip install python-dotenv
```

## Step 2 — Node.js dependencies

`mineflayer-collectblock` is a local TypeScript plugin referenced as a `file:` dependency. It must be compiled **before** the parent `npm install` picks it up:

```bash
cd voyager/env/mineflayer/mineflayer-collectblock
npm install
npx tsc
cd ..
npm install
```

To verify the Mineflayer server starts correctly:

```bash
node index.js 3000
# Expected: "Server started on port 3000"
# Press Ctrl+C to stop
```

## Step 3 — Minecraft

1. Launch Minecraft 1.19 with Fabric loader 0.14.18 and required mods installed
2. Create a world: Game Mode **Creative**, Difficulty **Peaceful**
3. `Esc` → **Open to LAN** → Allow Cheats: ON → **Start LAN World**
4. Note the port number shown in chat — that is your `MC_PORT`

## Step 4 — Environment variables

Create a `.env` file in the project root (already in `.gitignore`):

```
MC_PORT=XXXXX
OPENAI_API_KEY=sk-...
```

## Step 5 — Run

```bash
python run.py
```

`run.py` loads `.env` automatically via `python-dotenv`. No need to set environment variables manually.

## Expected runtime behaviour

- **"bot left game" / "bot connected to the game"** appearing repeatedly between tasks is normal. The environment resets the bot between each task (hard reset: clears inventory, respawns) to ensure a clean state for the next iteration.

# Getting Started
Voyager uses OpenAI models as the language backbone. You need an OpenAI API key — get one at [platform.openai.com/account/api-keys](https://platform.openai.com/account/api-keys).

## Quickstart with `.env`

The recommended way to run Voyager is via `run.py`, which reads all configuration from a `.env` file:

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
ACTION_ADVANCED_PRIMITIVES=true
```

Then:

```bash
python run.py
```

## Manual instantiation

You can also instantiate `Voyager` directly in Python:

```python
from voyager import Voyager

# Use mc_port for a local LAN world, or azure_login for Azure-managed Minecraft
voyager = Voyager(
    mc_port=YOUR_MC_PORT,
    openai_api_key="YOUR_API_KEY",
)

# start lifelong learning
voyager.learn()
```

For `Azure Login`:

```python
azure_login = {
    "client_id": "YOUR_CLIENT_ID",
    "redirect_url": "https://127.0.0.1/auth-response",
    "secret_value": "[OPTIONAL] YOUR_SECRET_VALUE",
    "version": "fabric-loader-0.14.18-1.19",
}

voyager = Voyager(
    azure_login=azure_login,
    openai_api_key="YOUR_API_KEY",
)
voyager.learn()
```

* If you are running with `Azure Login` for the first time, it will ask you to follow the command line instruction to generate a config file.
* For `Azure Login`, you also need to select the world and open the world to LAN by yourself. After you run `voyager.learn()` the game will pop up soon, you need to:
  1. Select `Singleplayer` and press `Create New World`.
  2. Set Game Mode to `Creative` and Difficulty to `Peaceful`.
  3. After the world is created, press `Esc` key and press `Open to LAN`.
  4. Select `Allow cheats: ON` and press `Start LAN World`. You will see the bot join the world soon.

# Resume from a checkpoint during learning

If you stop the learning process and want to resume from a checkpoint later, you can instantiate Voyager by:
```python
from voyager import Voyager

voyager = Voyager(
    mc_port=YOUR_MC_PORT,
    openai_api_key="YOUR_API_KEY",
    ckpt_dir="YOUR_CKPT_DIR",
    resume=True,
)
```

# Run Voyager for a specific task with a learned skill library

If you want to run Voyager for a specific task with a learned skill library, you should first pass the skill library directory to Voyager:
```python
from voyager import Voyager

# First instantiate Voyager with skill_library_dir.
voyager = Voyager(
    mc_port=YOUR_MC_PORT,
    openai_api_key="YOUR_API_KEY",
    skill_library_dir="./skill_library/trial1", # Load a learned skill library.
    ckpt_dir="YOUR_CKPT_DIR", # Do not use the same dir as skill library — new events are still recorded here.
    resume=False, # Do not resume from a skill library because this is not learning.
)
```
Then, you can run task decomposition. Notice: Occasionally, the task decomposition may not be logical. If you notice the printed sub-goals are flawed, you can rerun the decomposition.
```python
# Run task decomposition
task = "YOUR TASK" # e.g. "Craft a diamond pickaxe"
sub_goals = voyager.decompose_task(task=task)
```
Finally, you can run the sub-goals with the learned skill library:
```python
voyager.inference(sub_goals=sub_goals)
```

For all valid skill libraries, see [Learned Skill Libraries](skill_library/README.md).

# FAQ
If you have any questions, please check our [FAQ](FAQ.md) first before opening an issue.

# Paper and Citation

If you find our work useful, please consider citing us! 

```bibtex
@article{wang2023voyager,
  title   = {Voyager: An Open-Ended Embodied Agent with Large Language Models},
  author  = {Guanzhi Wang and Yuqi Xie and Yunfan Jiang and Ajay Mandlekar and Chaowei Xiao and Yuke Zhu and Linxi Fan and Anima Anandkumar},
  year    = {2023},
  journal = {arXiv preprint arXiv: Arxiv-2305.16291}
}
```

Disclaimer: This project is strictly for research purposes, and not an official product from NVIDIA.
