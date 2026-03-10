# Feature Specification: Static Blueprint Images

**Feature Branch**: `[008-static-blueprint-images]`  
**Created**: 2026-03-10  
**Status**: Draft  
**Input**: User description: "Add AI based image generation to the mystery with offline/static and online/dynamic options; this change introduces static blueprint images, authenticated image serving, generation utilities, and deployment utilities."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Illustrated Mystery Content (Priority: P1)

As a signed-in player, I can see curated static images for each mystery, character, and location so the story feels more immersive while I play.

**Why this priority**: This is the direct user value and the primary reason to add static blueprint images.

**Independent Test**: Can be fully tested with an E2E flow where a player opens the mystery list, starts a session, moves/talks through scenes, and verifies blueprint card, character portrait, and location images appear when mapped.

**Acceptance Scenarios**:

1. **Given** a blueprint with a mapped cover image, **When** the player opens the mystery list, **Then** that mystery shows its configured image.
2. **Given** a session step that narrates a character interaction with a mapped portrait, **When** the narration is shown, **Then** the character portrait is displayed with the narration.
3. **Given** a session step that narrates a location with a mapped location image, **When** the narration is shown, **Then** the location image is displayed with the narration.
4. **Given** an image mapping is missing or unavailable, **When** the related scene is rendered, **Then** gameplay continues with text-only narration and a non-blocking fallback visual state.
5. **Given** a blueprint has no image mappings, **When** the player browses and plays that mystery, **Then** no broken image placeholders are shown and gameplay remains fully available.

---

### User Story 2 - Generate Blueprint Image Set (Priority: P2)

As a content operator, I can generate either one required image or the full required image set for a blueprint so image content can be prepared quickly and linked back into blueprint fields.

**Why this priority**: Without generation tooling, static image adoption is too manual and slow for frequent blueprint updates.

**Independent Test**: Can be fully tested with an E2E operator flow that runs generation for a selected blueprint image target (single and all), confirms image artifacts are produced, and confirms blueprint image IDs are patched correctly.

**Acceptance Scenarios**:

1. **Given** a blueprint with missing image IDs, **When** the operator runs single-image generation for a chosen target, **Then** exactly that target receives a new image ID and other image mappings remain unchanged.
2. **Given** a blueprint with partial or missing image mappings, **When** the operator runs full-image generation, **Then** all required blueprint, character, and location image mappings are populated.
3. **Given** a blueprint with an art style profile, **When** images are generated, **Then** generated outputs align with the configured style, mood, lighting, and palette direction.

---

### User Story 3 - Securely Publish and Serve Images (Priority: P3)

As a platform operator, I can deploy blueprints together with their image assets and ensure images are only served to authenticated users, preventing anonymous abuse while keeping player experience reliable.

**Why this priority**: Secure and reliable serving is required to safely operate image-backed mysteries at scale.

**Independent Test**: Can be fully tested with an E2E flow that deploys a blueprint+image bundle, validates successful authenticated image rendering in the browser, and confirms unauthenticated requests are rejected.

**Acceptance Scenarios**:

1. **Given** a blueprint and its referenced images are ready, **When** the operator runs the deployment utility, **Then** the blueprint and image assets are published together and references remain valid.
2. **Given** an authenticated player requests an image by ImageID, **When** the image is available, **Then** the browser receives a valid renderable image resource.
3. **Given** an unauthenticated request for an image, **When** access is attempted, **Then** access is denied and no image bytes are returned.

### Edge Cases

- A blueprint has no image mappings, or references an ImageID that does not exist in storage at session start.
- A generated image file exists but automatic blueprint patching fails midway; operator recovery uses the known filename to patch the mapping.
- Duplicate image generation is requested for an already mapped target to refresh artwork.
- An image is accessible at deploy time but later removed or replaced.
- A player session expires between page load and image fetch.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The blueprint definition MUST support an art style profile that captures style direction, mood/atmosphere, lighting direction, and color palette.
- **FR-002**: The blueprint definition MUST support an optional top-level image reference (`ImageID`) for mystery list display.
- **FR-003**: Each blueprint character MUST support an optional portrait image reference (`ImageID`) for narration display.
- **FR-004**: Each blueprint location MUST support an optional location image reference (`ImageID`) for narration display.
- **FR-005**: The system MUST provide a way for the frontend to request an image using `ImageID` and receive a renderable image resource when authorized.
- **FR-006**: Image retrieval MUST require user authentication.
- **FR-007**: The system MUST deny unauthenticated image retrieval attempts.
- **FR-008**: The generation utility MUST support generating a single requested blueprint image target and patching only that target's `ImageID`.
- **FR-009**: The generation utility MUST support generating all required static image targets for a blueprint and patching all corresponding `ImageID` fields.
- **FR-010**: Generated images MUST be guided by the blueprint's configured art style profile plus target-specific narrative context.
- **FR-011**: The deployment utility MUST support publishing blueprint content together with referenced images in one operator workflow.
- **FR-012**: The deployment utility MUST validate that each referenced `ImageID` resolves to a deployable image before marking the blueprint publish step successful, while still allowing blueprints that provide no image references.
- **FR-013**: Player-facing flows MUST remain usable when an optional image is missing or unavailable, with a non-blocking fallback.
- **FR-014**: The current scope MUST be limited to static blueprint images; on-the-fly player-action image generation is out of scope for this change.
- **FR-015**: The generation utility MUST allow re-generation of an image target even when that target already has an `ImageID` mapping.
- **FR-016**: The operator workflow MUST support updating image mappings using known image filenames when automatic mapping updates fail.

### Key Entities *(include if feature involves data)*

- **Art Style Profile**: Stylistic configuration attached to a blueprint, including style, mood, lighting, and palette directives.
- **Image Asset**: A stored visual artifact identified by `ImageID` and associated metadata needed for retrieval and validation.
- **Blueprint Image Mapping**: The set of image references connecting blueprint cover, character portraits, and location images to `ImageID` values.
- **Generation Job Request**: Operator-triggered instruction to generate either one image target or all required targets for a blueprint.
- **Blueprint Image Deployment Bundle**: A publish unit that combines blueprint data and all referenced image assets.

### Assumptions

- Content operators are allowed to run generation and deployment utilities.
- Image style direction is authored per blueprint, not per individual player session.

### Dependencies

- Existing blueprint authoring workflow can accept additional visual metadata fields.
- Image storage and access-control capability is available in the backend platform.
- Operator tooling environment has permission to generate, patch, and publish blueprint/image artifacts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of blueprint publishes succeed for both image-rich and image-free blueprints, and every referenced `ImageID` in a published blueprint resolves to an available image at publish time.
- **SC-002**: At least 95% of authenticated image requests initiated during active sessions render in the player UI within 2 seconds.
- **SC-003**: 100% of unauthenticated image access attempts are rejected.
- **SC-004**: In operator testing, at least 90% of blueprints can be fully image-prepared (generate required assets and patch IDs) in a single full-generation run, and 100% of automatic patch failures are recoverable using filename-based mapping.
- **SC-005**: In player acceptance testing, at least 90% of testers report that visuals improve scene comprehension or immersion compared with text-only presentation.
