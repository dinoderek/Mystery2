# Data Model: Static Blueprint Images

**Feature**: `009-static-blueprint-images`  
**Date**: 2026-03-10  
**Phase**: 1 - Design

## Overview

This feature extends blueprint content with optional visual metadata and image references, introduces authenticated short-lived image access links, and adds operator-managed image generation/deployment workflows while preserving compatibility for image-less blueprints.

## Core Entities

### 1. BlueprintVisualMetadata

Optional visual metadata attached to blueprint-level metadata.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `art_style` | string | Operator/authored stylistic direction used for image generation | Optional; non-empty when present |
| `image_id` | string | Blueprint selection image reference | Optional; must map to known image ID when deployed |

Relationship: one `BlueprintVisualMetadata` belongs to one `Blueprint`.

### 2. CharacterVisualReference

Optional portrait reference for each character.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `character_key` | string | Stable character identity within blueprint context | Required; unique per blueprint |
| `portrait_image_id` | string | Portrait image reference used on `talk to` narration | Optional; valid image ID format when present |

Relationship: many character visual references belong to one blueprint.

### 3. LocationVisualReference

Optional image reference for each location.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `location_key` | string | Stable location identity within blueprint context | Required; unique per blueprint |
| `location_image_id` | string | Location image reference used on `move to` narration | Optional; valid image ID format when present |

Relationship: many location visual references belong to one blueprint.

### 4. ImageAsset

Stored static image object associated with blueprint imagery.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `image_id` | string | Canonical image identifier (`<blueprint-slug>-<uuid>`) | Required; globally unique |
| `blueprint_id` | uuid | Blueprint ownership reference | Required |
| `role` | enum | `blueprint_cover`, `character_portrait`, `location_scene` | Required |
| `source_path` | string | Local operator path before upload | Required for generation/deploy pipelines |
| `storage_key` | string | Remote storage object key | Required once uploaded |
| `status` | enum | `generated_local`, `uploaded`, `missing`, `failed` | Required |

Relationship: many image assets can belong to one blueprint.

### 5. ImageAccessLink

Auth-gated temporary access descriptor returned to the UI.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `image_id` | string | Requested image ID | Required |
| `signed_url` | string | Time-limited URL for browser fetch | Required when successful |
| `expires_at` | datetime | Expiration timestamp of the signed URL | Required when successful; must be in future at issuance |
| `status` | enum | `ok`, `not_found`, `unauthorized`, `expired` | Required |

Relationship: one access link is issued per image fetch request.

### 6. ImageGenerationRequest

Operator-provided generation run input.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `blueprint_path` | string | Source blueprint JSON path | Required; readable file |
| `target_scope` | enum | `all`, `blueprint`, `characters`, `locations`, `selected` | Required |
| `target_keys` | array<string> | Selected character/location keys when scoped | Optional for `all`/`blueprint`; required for selective scopes |
| `model` | string | Selected OpenRouter model identifier | Required |
| `output_dir` | string | Local destination directory for generated images | Required; writable |
| `overwrite` | boolean | Whether existing image files can be replaced | Required |

Relationship: one request creates one generation run and many generation results.

### 7. ImageGenerationResult

Per-target result entry for generation runs.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `target_key` | string | Blueprint/character/location target identifier | Required |
| `image_id` | string | Generated image ID for successful targets | Required for success |
| `file_path` | string | Written local image path | Required for success |
| `status` | enum | `generated`, `skipped`, `failed` | Required |
| `error_message` | string | Failure detail | Optional; required on `failed` |

Relationship: many generation results belong to one generation request.

### 8. DeploymentImageManifest

Image deployment status summary per blueprint deploy run.

| Field | Type | Description | Validation |
|------|------|-------------|------------|
| `blueprint_id` | uuid | Blueprint being deployed | Required |
| `attempted` | integer | Number of referenced images attempted for upload | Required; >= 0 |
| `uploaded` | integer | Number of successful uploads | Required; >= 0 |
| `missing` | integer | Number of references missing local files | Required; >= 0 |
| `failed` | integer | Number of attempted uploads that failed | Required; >= 0 |
| `warnings` | array<string> | Human-readable warning list | Required; can be empty |

Relationship: one deployment run emits one manifest per blueprint package.

## Validation Rules

- All visual metadata fields are optional; absence must not block gameplay, generation, or deployment.
- If present, `image_id` values must follow canonical ID format and map to image assets once deployed.
- `ImageAccessLink` issuance requires authenticated requester context.
- Expired or invalid signed URLs must not grant access.
- Generation patching must only update blueprint references for targets with `status=generated`.
- Deployment must succeed for blueprint JSON even when image manifest reports missing/failed assets.

## State Transitions

### ImageAsset Lifecycle

```text
generated_local -> uploaded -> served_via_signed_url
       |             |
       |             -> failed
       -> failed

(reference exists but file absent) -> missing
```

### Player Rendering Flow

```text
UI receives image_id (blueprint list / move / talk)
  -> UI requests ImageAccessLink (auth required)
     -> status=ok: render image
     -> status=not_found/expired/error: render placeholder
```

### Operator Workflow

```text
Generate request
  -> per-target generation results
  -> blueprint patch for generated targets only
  -> deploy blueprint + referenced images
  -> deployment manifest with warning details
```

## Scale Assumptions

- Typical blueprint image set size is one cover plus portraits/scenes for story entities; expected per-blueprint image count remains in tens, not thousands.
- Signed URL issuance volume tracks active gameplay commands and list views and is bounded by authenticated session traffic.
- Image payload size dominates network cost; metadata additions are small compared to narration payloads.
