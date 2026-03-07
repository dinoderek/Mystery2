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
npm run test:integration:live:default
npm run test:integration:live:cost-control
npm run test:e2e:live:default
npm run test:e2e:live:cost-control
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

## Execution Status (2026-03-07)

### Deterministic Quality Gates

- `npm run test:all` => PASS
  - Includes lint, typecheck, web check, unit, integration, API E2E, and Playwright suites
  - `svelte-check` reported one non-blocking warning (`a11y_autofocus`) and zero errors

### Live Profile Suite Results

- `npm run test:integration:live:default` => PASS
- `npm run test:integration:live:cost-control` => PASS
- `npm run test:e2e:live:default` => PASS
- `npm run test:e2e:live:cost-control` => PASS

Validation note:
- These runs executed with `AI_LIVE=1`, profile switching, and explicit `AI_MODEL` values.
- With `AI_PROVIDER=mock`, suites validate the live harness and profile wiring without external model calls.
- To validate against real OpenRouter models, set `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and the profile model env vars before running the same commands.
