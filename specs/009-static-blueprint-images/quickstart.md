# Quickstart: Static Blueprint Images

## Goal

Implement optional static blueprint imagery end-to-end: schema + API contracts, authenticated signed image links, UI rendering on blueprint list/move/talk with placeholder fallback, local generation utility, and deployment utility extension.

## Prerequisites

```bash
cd /Users/dinohughes/Projects/my2/w1
npm install
```

For integration and E2E suites, export local Supabase env values:

```bash
eval "$(npx supabase status -o env | awk -F= '/^[A-Z0-9_]+=/{print "export "$0}')"
```

## Implementation Sequence

1. Update shared contracts in `/Users/dinohughes/Projects/my2/w1/packages/shared/src/mystery-api-contracts.ts`:
   - Add optional blueprint/location/character image ID fields at the network boundary.
   - Add image-link request/response schemas.
2. Extend blueprint schema in `/Users/dinohughes/Projects/my2/w1/supabase/functions/_shared/blueprints/blueprint-schema.ts`:
   - Add optional `art_style`, blueprint image, character portrait, and location image references.
3. Add authenticated image-link issuance endpoint:
   - Implement `/Users/dinohughes/Projects/my2/w1/supabase/functions/blueprint-image-link/index.ts`.
   - Enforce auth and return signed URL + expiry metadata.
4. Update gameplay/list endpoints to expose image IDs:
   - `/Users/dinohughes/Projects/my2/w1/supabase/functions/blueprints-list/index.ts`
   - `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-move/index.ts`
   - `/Users/dinohughes/Projects/my2/w1/supabase/functions/game-talk/index.ts`
5. Implement web rendering and fallback behavior under `/Users/dinohughes/Projects/my2/w1/web/src/`:
   - Request signed image links for referenced IDs.
   - Render images at blueprint selection, move narration, and talk narration.
   - Render placeholder when referenced image fetch fails.
   - Keep styling in Tailwind using `t-*` theme tokens.
6. Add local generation tooling in `/Users/dinohughes/Projects/my2/w1/scripts/generate-blueprint-images.mjs`:
   - Support target subsets, model selection, output dir, and selective patching.
   - Keep generated outputs out of default git commits.
7. Extend deployment tooling in `/Users/dinohughes/Projects/my2/w1/scripts/deploy.mjs` and helper modules:
   - Deploy blueprint JSON and referenced image assets together.
   - Emit warning manifest for missing/failed image uploads.
   - Support `--image-dir <dir>` and `--strict-images` for deploy-time image sync policy.
8. Update docs with concise behavior and workflow changes:
   - `/Users/dinohughes/Projects/my2/w1/docs/architecture.md`
   - `/Users/dinohughes/Projects/my2/w1/docs/game.md`
   - `/Users/dinohughes/Projects/my2/w1/docs/project-structure.md`
   - `/Users/dinohughes/Projects/my2/w1/docs/testing.md`
   - `/Users/dinohughes/Projects/my2/w1/docs/component-inventory.md` (if new reusable UI components are introduced)

## Targeted Validation During Build

```bash
cd /Users/dinohughes/Projects/my2/w1
npm run test:unit
npm run test:integration
npm run test:e2e
npm -w web run test:e2e
```

## Generate Blueprint Images (Operator)

Generate a full image set (cover + characters + locations):

```bash
cd /Users/dinohughes/Projects/my2/w1
npm run generate:images -- \
  --blueprint-path supabase/seed/blueprints/mock-blueprint.json \
  --output-dir generated/blueprint-images \
  --model openai/gpt-image-1 \
  --all
```

Generate selected targets only:

```bash
cd /Users/dinohughes/Projects/my2/w1
npm run generate:images -- \
  --blueprint-path supabase/seed/blueprints/mock-blueprint.json \
  --output-dir generated/blueprint-images \
  --model openai/gpt-image-1 \
  --character "Alice" \
  --location "Kitchen"
```

Notes:
- Prefer `.env.local` for shared live-generation settings, with `OPENROUTER_API_KEY` and optional `OPENROUTER_IMAGE_MODEL`.
- Shell env overrides `.env.local` when needed.
- The script patches blueprint image IDs only for successfully generated targets.

## Deploy Blueprints + Images (Operator)

Deploy with image sync (missing images allowed, warnings emitted):

```bash
cd /Users/dinohughes/Projects/my2/w1
npm run deploy -- --env dev --image-dir generated/blueprint-images
```

Deploy with strict image policy (fail if any referenced image is missing/failed):

```bash
cd /Users/dinohughes/Projects/my2/w1
npm run deploy -- --env dev --image-dir generated/blueprint-images --strict-images
```

## End-to-End Manual Checks

1. Log in and open blueprint list; confirm blueprint image appears when `blueprint_image_id` exists.
2. Start a session and run `move to <location>` for a location with image reference; confirm side image appears.
3. Run `talk to <character>` for a character with portrait reference; confirm side portrait appears.
4. Expire or invalidate an image link and confirm placeholder appears without blocking narration.
5. Confirm unauthenticated image-link requests return auth failure.
6. Run generation utility for `all` targets and verify blueprint image IDs are patched for successful targets.
7. Run generation utility for selected targets and verify unselected references remain unchanged.
8. Deploy blueprint package with no images and confirm deploy success.
9. Deploy blueprint package with missing image files and confirm warning manifest reports missing assets while blueprint deploy succeeds.

## Required Quality Gates Before Merge

```bash
cd /Users/dinohughes/Projects/my2/w1
eval "$(npx supabase status -o env | awk -F= '/^[A-Z0-9_]+=/{print "export "$0}')"
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm -w web run test:e2e
```

## Expected Artifacts

- `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/plan.md`
- `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/research.md`
- `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/data-model.md`
- `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/contracts/static-blueprint-images.openapi.yaml`
- `/Users/dinohughes/Projects/my2/w1/specs/009-static-blueprint-images/quickstart.md`
