# Data Model: Static Blueprint Images

## Overview

This feature adds optional visual metadata and image references to blueprint content, plus operator-side generation/deployment models. Existing game session and event persistence models remain unchanged.

## Entities

### 1. BlueprintVisualProfile

- **Represents**: Art direction metadata attached to a blueprint.
- **Parent**: Blueprint metadata.
- **Fields**:
  - `style_direction` (string, optional)
  - `mood_atmosphere` (string, optional)
  - `lighting_direction` (string, optional)
  - `color_palette` (string, optional)
- **Validation rules**:
  - Empty profile is valid.
  - Non-empty fields are trimmed non-empty strings.

### 2. BlueprintImageRefs

- **Represents**: Optional image references across blueprint surfaces.
- **Parent**: Blueprint root + world sub-documents.
- **Fields**:
  - `blueprint_image_id` (string, optional) — cover image for mystery list.
  - `character_portrait_image_id` (string, optional) — per character.
  - `location_image_id` (string, optional) — per location.
- **Validation rules**:
  - Missing fields are valid.
  - When present, IDs must follow storage path-safe format and include filename with extension.
  - Duplicate references are allowed.

### 3. ImageAsset

- **Represents**: A stored image object addressable by `ImageID`.
- **Identity**: `image_id` (storage object path string).
- **Fields**:
  - `image_id` (string, required)
  - `bucket` (string, required; private image bucket)
  - `content_type` (string, required)
  - `byte_size` (integer, required)
  - `created_at` (timestamp, required)
  - `source_blueprint_id` (uuid, optional)
  - `target_kind` (`blueprint|character|location`, optional)
  - `target_key` (string, optional)
- **Validation rules**:
  - `image_id` must resolve to an object in the configured bucket.
  - `content_type` must be renderable image media type.

### 4. ImageResolveResult

- **Represents**: Authenticated resolution payload returned to browser for rendering.
- **Fields**:
  - `image_id` (string, required)
  - `signed_url` (string, required)
  - `expires_at` (timestamp, required)
  - `cache_ttl_seconds` (integer, required)
- **Validation rules**:
  - Returned only to authenticated callers.
  - URL expiration must be finite and short-lived.

### 5. GenerationJob

- **Represents**: Operator request to generate one or all blueprint images.
- **Fields**:
  - `job_id` (string, generated)
  - `blueprint_id` (uuid, required)
  - `mode` (`single|all`, required)
  - `target_kind` (`blueprint|character|location`, optional for `all`)
  - `target_key` (string, optional for `all`)
  - `overwrite` (boolean, required)
  - `status` (`pending|generated|patched|failed`, required)
  - `results[]` (array of per-target generation outcomes)
- **Validation rules**:
  - `single` mode requires `target_kind` and `target_key` (except blueprint target key may be omitted).
  - `overwrite=true` allows regeneration even if an ID already exists.
  - Patch failures must emit filename-based recovery data.

### 6. DeploymentBundle

- **Represents**: Atomic blueprint + image publish intent.
- **Fields**:
  - `bundle_id` (string, generated)
  - `blueprint_file` (path/string, required)
  - `referenced_image_ids[]` (array, optional)
  - `missing_image_ids[]` (array, computed)
  - `status` (`validating|uploaded|failed`, required)
- **Validation rules**:
  - Blueprints with zero image references are valid.
  - If references exist, each referenced `ImageID` must resolve before success.

## Relationships

- One **Blueprint** has zero or one **BlueprintVisualProfile**.
- One **Blueprint** references zero or one cover image, zero or many character portraits, and zero or many location images.
- One **GenerationJob** targets one Blueprint and produces zero or many **ImageAsset** records/references.
- One **DeploymentBundle** includes one Blueprint and zero or many **ImageAsset** references.
- One **ImageResolveResult** is derived from one **ImageAsset** for one authenticated request.

## State Transitions

### GenerationJob

- `pending -> generated -> patched`
- `pending -> failed`
- `generated -> failed`
- `failed -> patched` (manual recovery path via filename-based mapping)

### DeploymentBundle

- `validating -> uploaded`
- `validating -> failed`

## API Boundary Impact

- `BlueprintSummary` includes optional `image_id`.
- `GameState.locations[]` includes optional `image_id`.
- `GameState.characters[]` includes optional `portrait_image_id`.
- New authenticated image resolver payload introduces `signed_url` and expiration metadata.
