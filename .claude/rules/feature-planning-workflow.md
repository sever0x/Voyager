# Feature Planning Workflow (MANDATORY)

Any time the user asks to implement a new feature, mechanic, skill, or significant behavior change, you MUST follow this approval pipeline before writing a single line of code:

## Step 1 — Architecture alignment (minecraft-architect)

Spawn the `minecraft-architect` agent with the feature description. Iterate with it until the implementation plan covers all in-game scenarios, edge cases, resource constraints, and decision trees. This may take multiple rounds — keep refining until the architect produces a complete design blueprint with no open questions.

## Step 2 — Gameplay review (minecraft-gameplay-critic)

Spawn the `minecraft-gameplay-critic` agent and hand it the finalized blueprint from Step 1. The critic must return an **Overall Verdict** of "sound" for the plan to pass. If the critic flags Critical Issues, go back to Step 1 with the critic's feedback, re-align the architecture, and re-submit. Repeat until the critic approves with no Critical Issues.

## Step 3 — Human approval (BLOCKING)

Present the approved plan to the user in a clear, readable format:
- Feature summary (1–2 sentences)
- Full implementation plan (numbered steps, files to change)
- Architect notes (key design decisions)
- Critic verdict (copy the Overall Verdict and any remaining minor notes)

**Do NOT write any code, edit any file, or take any implementation action until the user explicitly approves the plan.** A message like "looks good", "go ahead", "approved", or "да" counts as approval. Anything ambiguous — ask again.

## Scope

This workflow applies to: new skills, new agents, new control primitives, changes to the reactive layer, changes to the observation space, new reset modes, new chat commands, new survival mechanics, and any change the user describes as a "feature" or "new behavior".

It does NOT apply to: bug fixes with a known, localized cause; documentation edits; dependency updates; formatting changes.
