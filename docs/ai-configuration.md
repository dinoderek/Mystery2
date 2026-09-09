# AI Configuration

There are four profiles. Three of them are **environment, not data** — `mock` is
built in, `free` and `paid` come from their env files, and there is nothing to
seed for any of them. The fourth, `default`, is what the browser actually plays
as, and it is **chosen on the settings page and stored in the database**.

That split is deliberate. `free` and `paid` are named explicitly by the live-AI
suites and the evaluation harness, so they have to be reproducible from files a
run can be handed. `default` is what a person picks, so it belongs somewhere a
person can change without restarting the server.

For day-to-day local setup and profile selection commands, see `../QUICKSTART.md`.
For the implementation-level matrix of which blueprint fields feed image and
runtime narration generation, see `docs/blueprint-generation-flows.md`.

## Canonical Rules

- Canonical default profile id is `default`.
- `game-start` uses `default` unless the request body includes `ai_profile`. The
  browser never sends one, so every played session is `default`.
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

## How `default` Resolves

Three sources, in order. The first that describes a usable configuration wins.

1. **The process environment.** `AI_PROVIDER` + `AI_MODEL`, layered over
   `.env.local`. This is what `npm run dev:ai:free` and `dev:ai:paid` set, and
   what keeps the mock test server mock by absence. A *broken* override here
   throws rather than falling through — a typo in an explicit flag must not
   quietly become something else.
2. **The settings database.** The mode, key and model last chosen on the
   settings page. Only reached when the process names nothing.
3. **Mock.**

Because step 1 outranks step 2, a server started with an override is running
something other than what the settings page shows as chosen. The page says so:
it renders a banner naming the provider and model being forced, and explains
that the stored choice takes effect on the next restart without it. The banner
and the resolver read the same helper (`readDefaultAIOverride`), so they cannot
disagree.

`OPENROUTER_API_KEY` on its own is **not** an override. A machine can keep a key
in `.env.local` and still let the settings page decide; only the two variables
that select a configuration count.

## The Settings Page

`/settings`, reachable from the profile picker at `/login` and **before a
profile exists** — a machine whose AI is misconfigured is exactly the one a
player cannot get past the picker on. It offers:

- **Mock vs Real AI.** Real AI is refused until both a key and a model are
  selected, so a stored `openrouter` is always something the runtime can call.
- **Labelled OpenRouter keys**, and **labelled models**. Both are label →
  value pairs, both support add / replace / delete.

Rows carry a `source`. `env` rows come from the filesystem and are re-read on
every start, so they are shown with an `[ENV]` badge and refuse edits and
deletes — an edit the next restart would silently undo is worse than no edit.
`user` rows were typed in on the page and can be changed freely. A `user` row
wins over an `env` row of the same label.

A stored key never leaves the server. The page sees only the last four
characters, and no response shape on this surface has a field that could carry
the value.

### Seeding from the environment

On startup, every `env` row is **deleted and re-inserted** from the filesystem —
not upserted — so a label removed from a file disappears rather than lingering
as a choice that no longer works. Three sources feed it, in increasing
precedence:

| File | Becomes |
| --- | --- |
| `.env.local` `OPENROUTER_API_KEY` | key `default` |
| `.env.ai.free.local` / `.env.ai.paid.local` | key and model `free` / `paid` |
| `.env.ai.local` `OPENROUTER_KEY_<LABEL>` / `AI_MODEL_<LABEL>` | key / model `<label>`, lowercased |

The first two exist so a machine already set up for `npm run dev:ai:free` has
usable choices without editing anything; those files still back the `free` and
`paid` profiles directly, and this only mirrors them into the picker.

```
# .env.ai.local
OPENROUTER_KEY_PERSONAL=sk-or-v1-...
AI_MODEL_SONNET=anthropic/claude-sonnet-4
AI_MODEL_LLAMA_FREE=meta-llama/llama-3.3-70b-instruct:free
```

A selection is stored as a **label**, not a foreign key, and is allowed to
dangle: if the label it names is gone after a reseed, narration falls back to
mock and the page says which label went missing. See the comment above the AI
tables in `packages/game-engine/src/db/schema.ts` for why the tables key on
`label` rather than a uuid.

## Local Configuration Summary

- `npm run dev` plays whatever the settings page last chose, and mock if it has
  chosen nothing.
- `npm run dev:ai:free` / `npm run dev:ai:paid` override that for the life of
  the process, and the settings page shows a banner saying so.
- Switching the browser's provider no longer needs a restart or a command —
  it is a choice on `/settings`.
- Local blueprint and image generation still use direct operator env values, not
  the settings tables.

## Testing And Mock Profile Rules

The default automated test path is mock-backed, and it is mock-backed by
absence: the suites start the server against a temporary config root with no
`.env.ai.*` files in it and a database nobody has chosen anything in, so
`default` falls through both sources to the built-in mock provider. Nothing is
seeded and nothing has to be reset between runs.

The settings row is a singleton — a property of the installation, not of a
player — and that breaks the isolation the rest of the suites rely on. They are
parallel and safe because every test owns a profile and touches only its own
sessions; the settings row belongs to no profile, so a test that changes it
changes it for every test sharing that server.

**No suite that shares a server with game-playing tests may switch the mode to
live.** It was tried: `tests/api/integration/ai-settings.test.ts` set
`openrouter` with a throwaway key, whichever test started a game in that window
got a 401 from the real openrouter.ai returned as an unexplained 500, and CI was
killed at its fifteen-minute cap when the calls hung instead. Locally the files
had interleaved harmlessly and it passed. Switching to live is asserted in the
unit suites, where it costs nobody: `tests/api/unit/ai-settings-store.test.ts`
and `tests/api/unit/local-engine-ai-profile.test.ts`.

The suites that mutate the row (`tests/api/integration/ai-settings.test.ts`,
`web/e2e/ai-settings.spec.ts`) reset it around each test and leave it on mock;
the browser one also runs serially within its file.

As a backstop, `scripts/run-mock-tests.mjs` and `web/playwright.config.ts` start
their server with `OPENROUTER_URL` pointing at a closed port, so a mock-mode
suite cannot reach a paid API at all. A slip fails in milliseconds with a
connection error instead of hanging or spending credits — but it still fails,
which is the point. The backstop is not the rule.

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
- `packages/game-engine/src/ai-settings-env.ts`
- `packages/game-engine/src/db/ai-settings.ts`
- `web/src/routes/api/ai-settings/**` and `web/src/routes/settings/+page.svelte`
- `tests/api/unit/ai-provider.test.ts`
- `tests/api/unit/local-engine-ai-profile.test.ts`
- `tests/api/unit/ai-settings-store.test.ts`
- `tests/api/unit/ai-settings-env.test.ts`
- `tests/api/integration/ai-profile-runtime.test.ts`
- `tests/api/integration/ai-settings.test.ts`
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
