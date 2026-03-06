# Quickstart: AI Backend Integration for Narrative Turns

## Goal

Validate role-specific AI orchestration, anti-leak context boundaries, accusation rounds, and profile-based live-AI regression.

## Prerequisites

```bash
cd /Users/dinohughes/Projects/my2/w1
npm install
npx supabase start
```

Ensure backend environment includes provider configuration for live runs (values shown are examples):

```bash
export OPENROUTER_API_KEY="<server-only-secret>"
export AI_PROVIDER="openrouter"
export AI_PROFILE_DEFAULT_MODEL="google/gemini-3-flash-preview"
export AI_PROFILE_COST_CONTROL_MODEL="z-ai/glm-4.5-air:free"
```

## Deterministic Quality Gates (default)

These remain the required baseline checks and exclude live-AI suites:

```bash
npm run test:all
```

## Dedicated Live-AI Validation

Run live integration and API E2E suites explicitly per profile.

```bash
# Default profile live integration
AI_LIVE=1 AI_PROFILE=default vitest run tests/api/integration/live-ai

# Cost-control profile live integration
AI_LIVE=1 AI_PROFILE=cost_control vitest run tests/api/integration/live-ai

# Default profile live API E2E investigator script
AI_LIVE=1 AI_PROFILE=default vitest run tests/api/e2e/live-ai-flow.test.ts

# Cost-control profile live API E2E investigator script
AI_LIVE=1 AI_PROFILE=cost_control vitest run tests/api/e2e/live-ai-flow.test.ts
```

## Manual Verification Checklist

1. Start a game and enter talk mode with a visible character.
2. Ask multiple questions and confirm continuity is preserved.
3. End talk and confirm mode returns to `explore`.
4. Trigger search and confirm contract-valid narration from the AI role (clue discovery behavior remains owned by existing backend rules).
5. Start accusation (`game-accuse`) and confirm scene framing response.
6. Continue accusation interaction through the existing `game-accuse` flow and confirm resolution reaches `win` or `lose`.
7. Verify non-accusation responses never reveal full solution facts.
8. Simulate provider failure and confirm retryable error is returned without finalizing turn outcome.

## Artifacts to Inspect During Validation

- Session/event progression: `game_sessions` and `game_events` rows in Supabase Studio.
- Contract compliance: role output validation failures logged by Edge Functions.
- Live profile parity: compare investigator script checkpoints across `default` and `cost_control` profiles.
- Documentation completeness: verify `docs/ai-runtime.md` exists and core docs include a concise overview of AI integration changes.
