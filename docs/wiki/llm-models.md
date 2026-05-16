# LLM Models — Current Configuration & Cost Reference

This document records the active LLM model configuration, pricing baseline, and evaluated alternatives. Update this file whenever the model lineup changes.

**Baseline recorded:** 2026-05-16  
**Provider:** OpenAI (direct)

---

## Current Configuration

| Parameter | Model | Task | Price — Input / Output (per 1M tokens) |
|-----------|-------|------|----------------------------------------|
| `ACTION_MODEL` | `gpt-5.4-mini` | Generate JavaScript code for bot actions | $0.75 / $4.50 |
| `CURRICULUM_MODEL` | `gpt-5.4-mini` | Propose next task (curriculum planning) | $0.75 / $4.50 |
| `CURRICULUM_QA_MODEL` | `gpt-5.4-nano` | Q&A context retrieval for curriculum | $0.20 / $1.25 |
| `CRITIC_MODEL` | `gpt-5.4-mini` | Verify task completion (JSON output) | $0.75 / $4.50 |
| `SKILL_MODEL` | `gpt-5.4-nano` | Generate skill descriptions | $0.20 / $1.25 |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Skill & Q&A retrieval via Chroma | $0.020 / 1M |

**`.env` defaults (from `.env.example`):**
```
LLM_PROVIDER=openai
EMBEDDING_PROVIDER=openai
ACTION_MODEL=gpt-5.4-mini
CURRICULUM_MODEL=gpt-5.4-mini
CURRICULUM_QA_MODEL=gpt-5.4-nano
CRITIC_MODEL=gpt-5.4-mini
SKILL_MODEL=gpt-5.4-nano
EMBEDDING_MODEL=text-embedding-3-small
```

All models are injected via `voyager/utils/llm_factory.py`. Switching provider or model requires only `.env` changes — no code edits needed. Supported providers: `openai`, `openrouter`, `anthropic`.

---

## Evaluated Alternatives (OpenRouter)

Researched on 2026-05-16. All prices are OpenRouter pass-through rates (no markup).

### Drop-in replacements via `LLM_PROVIDER=openrouter`

#### Tier 1 — Maximum savings

| Slot | Model | OpenRouter ID | Input / Output | vs. current output |
|------|-------|--------------|----------------|-------------------|
| ACTION | MiniMax M2.7 | `minimax/minimax-m2.7` | $0.28 / $1.20 | **-73%** |
| CURRICULUM | MiniMax M2.5 | `minimax/minimax-m2.5` | $0.15 / $1.15 | **-74%** |
| CURRICULUM_QA | Gemini 2.5 Flash Lite | `google/gemini-2.5-flash-lite` | $0.10 / $0.40 | **-68%** |
| CRITIC | Gemini 2.5 Flash Lite | `google/gemini-2.5-flash-lite` | $0.10 / $0.40 | **-91%** |
| SKILL | Gemini 2.5 Flash Lite | `google/gemini-2.5-flash-lite` | $0.10 / $0.40 | **-68%** |

#### Tier 2 — Balanced (quality closer to baseline)

| Slot | Model | OpenRouter ID | Input / Output |
|------|-------|--------------|----------------|
| ACTION | Gemini 2.5 Flash | `google/gemini-2.5-flash` | $0.30 / $2.50 |
| ACTION | DeepSeek V3.2 | `deepseek/deepseek-v3.2` | $0.25 / $0.38 |
| CURRICULUM | DeepSeek V3.2 | `deepseek/deepseek-v3.2` | $0.25 / $0.38 |

### Model notes

**MiniMax M2.7** — sparse MoE, ~230B total / 10B active per token. 56.2% SWE-Pro, 3× faster than M2.5.  
**MiniMax M2.5** — 80.2% SWE-Bench Verified. Best price/performance for complex code generation.  
**Gemini 2.5 Flash Lite** — cheapest reliable option for structured JSON and short summarization tasks.  
**DeepSeek V3.2** — strong general coder, extremely cheap output ($0.38/1M). Chinese provider — consider data sensitivity.  
**Kimi K2.5** (`moonshotai/kimi-k2.5`, $0.40/$1.90) — multimodal, 262K context. No meaningful advantage for Voyager's text/code workloads.  
**Kimi K2.6** (`moonshotai/kimi-k2.6`, $0.73/$3.49) — most capable Kimi, but output price similar to current baseline.

### Embeddings

`text-embedding-3-small` ($0.020/1M) is the only tested embedding model.  
`Google text-embedding-005` costs $0.006/1M (70% cheaper), but switching requires deleting both Chroma vectordb directories:
```
ckpt/skill/vectordb/
ckpt/curriculum/vectordb/
```
Do not switch embedding models mid-run. See CLAUDE.md — *"Vectordb dirs must be deleted when switching embedding models."*

---

## How to Switch Provider

1. Set `LLM_PROVIDER=openrouter` and `OPENROUTER_API_KEY=sk-or-...` in `.env`
2. Set individual `*_MODEL` vars to the OpenRouter model IDs above
3. Leave `EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY` in place — embeddings must remain on OpenAI until a deliberate vectordb rebuild

Example Tier 1 `.env` block:
```
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...

ACTION_MODEL=minimax/minimax-m2.7
CURRICULUM_MODEL=minimax/minimax-m2.5
CURRICULUM_QA_MODEL=google/gemini-2.5-flash-lite
CRITIC_MODEL=google/gemini-2.5-flash-lite
SKILL_MODEL=google/gemini-2.5-flash-lite

EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
```
