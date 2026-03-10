# Quickstart: Static Blueprint Images

## Purpose

Implement and validate static blueprint images with authenticated serving, generation utilities, and blueprint+image deployment utilities.

## Prerequisites

- Repository root: `/Users/dinohughes/Projects/my2/w1`
- Local environment configured (`.env.local` with Supabase keys)
- Supabase local stack available (`npm run setup:local` if not already running)
- Existing blueprint JSON files available under `/Users/dinohughes/Projects/my2/w1/blueprints` or `/Users/dinohughes/Projects/my2/w1/supabase/seed/blueprints`

## 1) Update contracts and blueprint schema first

1. Extend `/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts` with:
   - Optional `image_id` on blueprint summaries.
   - Optional location/character image references in game state where needed.
   - Request/response contracts for image resolve + generation/deploy endpoints.
2. Extend `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/blueprint-schema.ts` with:
   - Optional art-style profile fields.
   - Optional blueprint/character/location image IDs.

## 2) Implement secure image serving

1. Add `/Users/dinohughes/Projects/my2/w1/supabase/functions/image-resolve/index.ts`.
2. Require JWT auth and reject unauthenticated requests.
3. Resolve `image_id` to a short-lived signed URL in the private image bucket.
4. Return URL + expiration metadata for browser rendering and cache control.

## 3) Implement generation utility

1. Add `/Users/dinohughes/Projects/my2/w1/scripts/generate-blueprint-images.mjs`.
2. Support modes:
   - single target generation (`blueprint|character|location`)
   - full blueprint generation (`all`)
3. Support overwrite/regeneration when mappings already exist.
4. On patch failures, output filename-based recovery hints so operators can patch by known filename.

## 4) Implement deployment utility

1. Add `/Users/dinohughes/Projects/my2/w1/scripts/deploy-blueprint-images.mjs`.
2. Upload blueprint JSON and referenced image assets in one workflow.
3. Validate that each referenced image exists before declaring success.
4. Accept image-free blueprints as valid deploys.

## 5) Integrate frontend rendering

1. Update `/Users/dinohughes/Projects/my2/w1/web/src/lib/types/game.ts` and `/Users/dinohughes/Projects/my2/w1/web/src/lib/domain/store.svelte.ts` for image-aware types/state.
2. Render optional cover images on `/Users/dinohughes/Projects/my2/w1/web/src/routes/+page.svelte`.
3. Render optional portrait/location visuals in `/Users/dinohughes/Projects/my2/w1/web/src/routes/session/+page.svelte`.
4. Ensure missing IDs or missing files never block gameplay and never show broken placeholders.

## 6) Validate with tests

Run feature-relevant tests during implementation:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm -w web run test:e2e
```

Run full quality gate before completion:

```bash
npm run test:all
```

## 7) Manual verification checklist

1. Authenticated player sees cover/portrait/location images when IDs exist.
2. Image-free blueprint remains fully playable with clean text-only fallback.
3. Unauthenticated image resolve request returns 401/403.
4. Single-target generation updates only selected mapping.
5. All-target generation populates all missing/selected mappings.
6. Duplicate generation (overwrite) refreshes an existing mapping.
7. Blueprint+image deploy succeeds for valid references and reports missing references clearly.
