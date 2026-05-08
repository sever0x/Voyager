# Voyager Buddy — Developer Wiki

This wiki documents the internal architecture, implementation decisions, and phase-by-phase development history of the Voyager Buddy project.

**Project goal:** Transform [Voyager](https://github.com/MineDojo/Voyager) from a solo Minecraft exploration agent into a fully autonomous survival co-op companion that a real player can play alongside.

---

## Contents

| Document | What it covers |
|---|---|
| [Architecture Overview](architecture.md) | How the two-runtime system works; Python/Node.js split; observation space; communication patterns |
| [Phase 1 — Architectural Foundations](phase-1-foundations.md) | What was built in Phase 1, why each change was needed, and the exact files that changed |

Roadmap technical design documents (pre-implementation specs) live in [`docs/roadmap/`](../roadmap/):
- [`phase-1-architectural-foundations.md`](../roadmap/phase-1-architectural-foundations.md)
- [`phase-2-survival-core.md`](../roadmap/phase-2-survival-core.md)

---

## Project Status

| Phase | Name | Status |
|---|---|---|
| 1 | Architectural Foundations | ✅ Complete |
| 2 | Survival Core | 🔲 Not started |
| 3 | Progression & Tech Tree | 🔲 Not started |
| 4 | Communication & Personality | 🔲 Not started |
| 5 | Cooperative Logic | 🔲 Not started |
| 6 | World Memory & End Game | 🔲 Not started |

---

## Repository Layout

```
voyager/
├── agents/              # Python — LLM agents (Curriculum, Action, Critic, Skill)
├── env/
│   ├── bridge.py        # Python-side gym.Env wrapper
│   └── mineflayer/
│       ├── index.js     # Express server — /start, /step endpoints
│       ├── lib/
│       │   ├── reactive/        # Reactive rules engine (Phase 1)
│       │   └── observation/     # Per-field observation modules
│       └── control_primitives/ # JS utility functions injected into bot context
├── prompts/             # Plain-text LLM prompt templates
└── voyager.py           # Top-level orchestrator — learn() loop

docs/
├── roadmap/             # Pre-implementation technical design documents
└── wiki/                # This wiki — post-implementation documentation
```
