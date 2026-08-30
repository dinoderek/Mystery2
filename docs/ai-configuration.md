# AI Configuration

AI profiles are **environment, not data**. There is no `ai_profiles` table and
nothing to seed: `mock` is built in, `free` and `paid` come from their env
files, and `default` is whatever the running process is configured with.

For day-to-day local setup and profile selection commands, see `../QUICKSTART.md`.
For the implementation-level matrix of which blueprint fields feed image and
runtime narration generation, see `docs/blueprint-generation-flows.md`.

## Canonical Rules

- Canonical default profile id is `default`.
- `game-start` uses `default` unless the request body includes `ai_profile`.
- Existing sessions stay pinned to their stored `ai_profile_id` **label**, and
  that label is resolved again on every request — so a config change takes
  effect mid-session, with no restart.
- A misconfigured profile (unknown provider, missing model, `openrouter` with
  no key) **throws**, surfacing as a 500. A profile that is simply not
  configured on this machine returns `null`, which `game-start` turns into
  `400 Invalid ai_profile`. Neither silently falls back to mock.
- The OpenRouter key is read by the server from the environment and never
  reaches the browser.
- Local-only operator config can be relocated by setting `MYSTERY_CONFIG_ROOT`
  to an absolute path. When unset, local-only files resolve from the repo root.

This document is the canonical source for:

- `default` vs named local profiles (`mock`, `free`, `paid`)
- which local and test workflows rely on the mock provider

## OpenRouter Injection Map

- Local live gameplay:
  - `.env.ai.free.local` / `.env.ai.paid.local` provide `AI_PROVIDER`,
    `AI_MODEL`, and `OPENROUTER_API_KEY`
  - when `MYSTERY_CONFIG_ROOT` is set, those files resolve from that directory
    instead of the repo root
  - a key absent from the mode file falls back to `OPENROUTER_API_KEY` in
    `.env.local`
- Runtime use:
  - `npm run dev:ai:free` loads the mode file into the server process
  - `packages/game-engine/src/ai-profile.ts` resolves a request's profile from
    that environment, per request
- Blueprint generation:
  - `scripts/generate-blueprint.mjs` is operator tooling, not gameplay runtime
  - it loads `OPENROUTER_API_KEY` from shell env, then `.env.local`
  - when `MYSTERY_CONFIG_ROOT` is set, `.env.local` resolves from that directory
  - it loads model defaults from `OPENROUTER_BLUEPRINT_MODEL`, then `AI_MODEL`, then CLI `--model` overrides
- repeated `--brief-file` and `--model` flags generate every brief/model combination
- multi-job runs write composed files via `--output-file` as `<output-file>.<model>.<brief filename>.json`
- whenever a blueprint file is written, the CLI also runs post-generation verification and writes `<blueprint-file>.verification.json` beside it
- `--chat-packet` switches the CLI into copy/paste packet mode:
  - no OpenRouter request is made
  - no verification request is made
  - output defaults to `{MYSTERY_CONFIG_ROOT}/chat-gen-prompts/blueprint-packet.*.chat.md`
  - packet content is built from the same generator prompt, user-message JSON, and response-schema builder used by the live API path
  - `--model` is ignored completely in chat mode so packets stay model-agnostic
- post-generation verification runs offline, in-process mechanical checks (no verifier model, no extra network call) and writes a pass/fail structural report to the sibling verification artifact
- if the model returns JSON that fails Blueprint V2 schema validation, the CLI still persists that raw JSON to the target blueprint file and records the failure in the sibling verification artifact
- `--parallel` runs all queued jobs concurrently; `--parallelism <n>` caps concurrent jobs
- it uses `AI_OPENROUTER_TIMEOUT_MS` for request timeout control (default `120000`)
- Image generation:
  - `scripts/generate-blueprint-images.mjs` is operator tooling, not gameplay runtime
  - it loads `OPENROUTER_API_KEY` from shell env, `.env.images.local`, then `.env.local`
  - when `MYSTERY_CONFIG_ROOT` is set, those local-only files resolve from that directory
  - it uses `AI_OPENROUTER_TIMEOUT_MS` for request/download timeout control (default `120000`)
- `--chat-packets` writes one markdown packet per selected target into `{MYSTERY_CONFIG_ROOT}/chat-gen-prompts/images` by default
- `--chat-packets-combined` writes all targets into a single combined markdown file (useful for working through all images in one ChatGPT/Gemini session)
- chat-packet mode never calls OpenRouter and never patches blueprint image IDs
- packets include a "Copy-Paste Prompt" section (unfenced) for easy selection in web UIs, plus "Save Instructions" with the expected filename and follow-up `--import-images` command
- `--model` is ignored completely in chat mode so packets stay model-agnostic
- `--dry-run` and `--dry-mode` are invalid in chat-packet mode because the packet itself is now the no-network export format
- `--import-images` scans a directory for `.png` files matching the expected naming convention, patches the blueprint with matched image IDs
- `--import-dir <dir>` overrides the directory to scan (default: `{MYSTERY_CONFIG_ROOT}/blueprint-images`)
- `--import-images` cannot be combined with `--chat-packets`, `--dry-run`, or `--dry-mode`

## Local Configuration Summary

- `npm run dev` points `default` to `mock`.
- `npm run dev:ai:free` / `npm run dev:ai:paid` point `default` to that mode.
- Switching profile is switching command — there is nothing to seed.
- gameplay/runtime OpenRouter config stays DB-first; local blueprint/image generation use direct operator env values instead of AI profile rows

## Testing And Mock Profile Rules

The default automated test path is mock-backed, and it is mock-backed by
absence: the suites start the server against a temporary config root with no
`.env.ai.*` files in it, so `default` resolves to the built-in mock provider.
Nothing is seeded and nothing has to be reset between runs.

`tests/api/integration/ai-profile-runtime.test.ts` writes a `free` profile into
that temporary root, plays a turn, breaks the file, and asserts the next turn
fails — which is how per-request resolution stays proven.

## Change Management For AI Runtime Work

When changing AI output contracts, prompt/context shape, provider selection, or
profile resolution:

- update mock-provider coverage in `tests/api/unit/ai-provider.test.ts`
- update any affected integration or API E2E assertions that rely on mock
  narration or the `default` profile

Typical touchpoints include:

- `packages/game-engine/src/ai-provider.ts`
- `packages/game-engine/src/ai-profile.ts`
- `tests/api/unit/ai-provider.test.ts`
- `tests/api/unit/local-engine-ai-profile.test.ts`
- `tests/api/integration/ai-profile-runtime.test.ts`
- `tests/api/e2e/*` when journey assertions depend on mock behavior

## Blueprint Generation Configuration

Use CLI flags or `.env.local` for operator blueprint-generation settings:

- `OPENROUTER_API_KEY=<secret>`
- `OPENROUTER_BLUEPRINT_MODEL=<model-id>` optional; comma-separated values are supported
- `AI_MODEL=<model-id>` fallback only when `OPENROUTER_BLUEPRINT_MODEL` is unset

The blueprint-generation CLI resolves config in this order:

1. CLI flags at invocation time
2. shell env at invocation time
3. `.env.local` from `MYSTERY_CONFIG_ROOT` when set, otherwise from the repo root

Operator flags:

- repeat `--brief-file <path>` to queue multiple story briefs
- repeat `--model <model-id>` to queue multiple models
- `--output <path>` writes a single job to an exact file path
- `--output-file <path>` writes one file per queued job using the composed filename
- `--chat-packet` writes markdown packets instead of calling OpenRouter; if no output path is given it defaults under `chat-gen-prompts/`
- successful file-writing jobs also emit a sibling verification JSON file
- file-writing runs print a final stdout summary instead of blueprint JSON
- `--parallel` or `--parallelism <n>` enable concurrent generation

Timeout behavior:

- `AI_OPENROUTER_TIMEOUT_MS=<milliseconds>` optional
- default is `120000`

## Image Generation Configuration

The image-generation CLI calls OpenRouter's dedicated Images API
(`POST https://openrouter.ai/api/v1/images`). Image models are rejected by
`/chat/completions` with a 404. Responses carry the image as
`data[0].b64_json`; the CLI requests `output_format: "png"` and writes those
bytes straight to `<image_id>.png`.

Use `.env.images.local` for operator image-generation settings:

- `OPENROUTER_API_KEY=<secret>`
- `OPENROUTER_IMAGE_MODEL=<model-id>` optional
- `OPENROUTER_IMAGE_ASPECT_RATIO=<ratio>` optional

The image-generation CLI resolves config in this order:

1. shell env at invocation time
2. `.env.images.local` from `MYSTERY_CONFIG_ROOT` when set, otherwise from the repo root
3. `.env.local` from `MYSTERY_CONFIG_ROOT` when set, otherwise from the repo root
4. built-in defaults (model `openai/gpt-image-2`, aspect ratio `4:3`)

Operator flags:

- `--model <model-id>` overrides the image model for one run
- `--aspect-ratio <ratio>` overrides the output ratio; it is sent as the
  `aspect_ratio` request param *and* interpolated into the prompt's `Output:`
  line, so the two cannot disagree
- `--chat-packets` writes one markdown prompt packet per selected target instead of calling OpenRouter
- if `--output-dir` is omitted in chat mode, packets default to `chat-gen-prompts/images`
- packets are one-way operator artifacts: you upload any reference images manually and paste the prompt into chat yourself

Aspect-ratio support is per-model and the CLI only validates syntax. Run
`curl https://openrouter.ai/api/v1/images/models` (public, no auth) to see each
model's `supported_parameters`; anything unsupported comes back as a 400 with
OpenRouter's own explanation. Note that `openai/gpt-image-1` accepts only
`1:1`, `3:2`, `2:3`, and `auto` — pinning it requires `--aspect-ratio 3:2`.

Reference images (character portraits fed into location scenes, and both fed
into the cover) are sent as `input_references[]` base64 PNG data URLs and are
capped at 16, the limit the gpt-image family advertises. A target that exceeds
the cap logs a warning and sends the first 16.

Failure behavior:

- a failed or cancelled generation returns HTTP 502 and is **not** billed
- per-target failures are reported and the run continues; re-run just the
  affected targets with `--character` / `--location`

Timeout behavior:

- `AI_OPENROUTER_TIMEOUT_MS=<milliseconds>` optional — the same knob covers
  image generation and text generation
- default is `120000`
