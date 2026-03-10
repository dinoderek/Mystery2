# Feature Specification: Static Blueprint Images

**Feature Branch**: `009-static-blueprint-images`  
**Created**: 2026-03-10  
**Status**: Draft  
**Input**: User description: "Add static story images to blueprints, generation, deployment, and authenticated display flows"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Story Images In Gameplay (Priority: P1)

As an authenticated player, I can see optional blueprint, location, and character images during blueprint selection and narration so the story is easier to understand and more engaging.

**Why this priority**: This is the primary player-facing value and the reason to add static images.

**Independent Test**: Can be fully tested by running an authenticated end-to-end gameplay session that includes blueprint selection, `move to`, and `talk to`, then confirming image display rules and fallback behavior without relying on other stories.

**Acceptance Scenarios**:

1. **Given** an authenticated player opens the blueprint selection screen and a blueprint has an image reference, **When** the blueprint list is rendered, **Then** the blueprint image is displayed with that blueprint entry.
2. **Given** an authenticated player runs `move to <location>` and that location has an image reference, **When** narration for the move is shown, **Then** the location image is shown beside the narration.
3. **Given** an authenticated player runs `talk to <character>` and that character has a portrait reference, **When** narration for the talk start is shown, **Then** the character portrait is shown beside the narration.
4. **Given** an image reference exists but the image cannot be fetched, **When** the narration is rendered, **Then** the system applies the configured fallback behavior (hide image region or show placeholder) without blocking gameplay text.
5. **Given** a user is not authenticated, **When** they attempt to fetch any blueprint image, **Then** image access is denied.

---

### User Story 2 - Generate Blueprint Image Set Locally (Priority: P2)

As an operator, I can generate one or more static images for a blueprint on my local machine and automatically patch blueprint image references, so image management is fast and consistent.

**Why this priority**: Manual image authoring and manual reference updates are error-prone; a generation tool reduces operational effort and inconsistency.

**Independent Test**: Can be fully tested by running the generation command for one blueprint in a local workspace, selecting different target scopes (all, locations only, characters only, blueprint image only), and verifying that new image files and updated references are produced.

**Acceptance Scenarios**:

1. **Given** a blueprint with stylistic direction and narrative descriptions, **When** the operator requests generation for all targets, **Then** image files are created and all generated targets receive updated image references in the blueprint.
2. **Given** a blueprint with existing image references, **When** the operator requests generation for only selected characters or locations, **Then** only selected targets are updated and unselected references remain unchanged.
3. **Given** the operator specifies a model option and output directory, **When** generation runs, **Then** the selected model is used and images are written to the specified directory.
4. **Given** generation fails for one target, **When** the run completes, **Then** the tool reports the failed target and preserves already-generated outputs and successful reference patches.

---

### User Story 3 - Deploy Blueprints And Images Together (Priority: P3)

As an operator, I can deploy blueprint data and associated static images in one deployment workflow so published stories stay in sync.

**Why this priority**: Unified deployment prevents mismatch between blueprint references and available assets.

**Independent Test**: Can be fully tested by running deployment for a blueprint package with and without images and confirming both blueprint availability and image accessibility behavior post-deploy.

**Acceptance Scenarios**:

1. **Given** a blueprint with valid image references and local image files, **When** the operator deploys the blueprint, **Then** blueprint data and referenced images are both published in one run.
2. **Given** a blueprint has no image references, **When** the operator deploys it, **Then** deployment succeeds and the blueprint remains playable.
3. **Given** a blueprint references images that are missing locally, **When** deployment runs, **Then** deployment completes with clear warnings for missing images and no corruption of blueprint data.

---

### Edge Cases

- A blueprint references an image identifier that exists in data but the backing image file was never uploaded.
- A player session expires between loading narration text and loading the associated image.
- The operator generates only a subset of images, leaving older image references for other entities.
- Two generated images accidentally receive the same identifier.
- Deployment includes a blueprint update but image upload partially fails.
- Blueprint has no image-related fields at all (legacy blueprint format).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support an optional artistic direction field in each blueprint to guide image generation style.
- **FR-002**: The system MUST support an optional image reference on blueprint-level metadata for use in blueprint selection.
- **FR-003**: The system MUST support an optional portrait image reference for each character.
- **FR-004**: The system MUST support an optional location image reference for each location.
- **FR-005**: The system MUST provide an operator workflow to generate static images locally from blueprint content and style direction.
- **FR-006**: The generation workflow MUST allow target selection for all images, blueprint image only, selected characters, and selected locations.
- **FR-007**: The generation workflow MUST allow the operator to choose the generation model per run.
- **FR-008**: The generation workflow MUST assign unique image identifiers and patch blueprint references for all successfully generated targets.
- **FR-009**: The generation workflow MUST write output images to an operator-specified local directory.
- **FR-010**: The system MUST ensure generated image files are excluded from default source-control commits.
- **FR-011**: The deployment workflow MUST support publishing blueprint data and related images in one operator action.
- **FR-012**: The deployment workflow MUST remain successful for blueprints with no image references.
- **FR-013**: The deployment workflow MUST report missing or failed image uploads without invalidating successfully deployed blueprint data.
- **FR-014**: The system MUST require authentication for all image fetch operations.
- **FR-015**: The application MUST display blueprint images in blueprint selection when a blueprint image reference is available.
- **FR-016**: The application MUST display location images during `move to` narration when a location image reference is available.
- **FR-017**: The application MUST display character portraits during `talk to` narration when a character portrait reference is available.
- **FR-018**: The application MUST support a defined fallback mode for missing images (hide image region or show placeholder) and apply it consistently.
- **FR-019**: The system MUST keep gameplay functional when image references are absent, broken, or omitted.
- **FR-020**: The system MUST provide clear operator-facing error output for generation and deployment failures.

### Key Entities *(include if feature involves data)*

- **Blueprint Visual Metadata**: Optional blueprint-level visual fields including artistic direction and blueprint image reference.
- **Character Portrait Reference**: Optional link from a character record to an image identifier used during character narration.
- **Location Image Reference**: Optional link from a location record to an image identifier used during move narration.
- **Image Asset**: A static image file identified by a unique image identifier and associated with one blueprint deployment context.
- **Image Generation Request**: Operator-provided run definition containing blueprint target, selected image targets, model selection, and output directory.
- **Deployment Package**: Operator deployment payload that contains blueprint data plus zero or more related image assets.

### Assumptions

- Existing authentication behavior for gameplay remains unchanged and is reused for image access control.
- Operators have permission to read/write the selected local image directory.
- Existing non-image blueprint fields and gameplay mechanics remain unchanged.
- Image references are optional for all blueprint types, including legacy blueprints.

### Dependencies

- Access to an approved image generation provider account and model catalog.
- Available backend image storage capacity for uploaded blueprint assets.
- Operator deployment credentials with permission to publish both blueprint data and image assets.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of unauthenticated image fetch attempts are denied in acceptance and regression test runs.
- **SC-002**: At least 95% of authenticated image fetches for valid references render visible imagery in the UI within 2 seconds during test runs.
- **SC-003**: Operators can generate and patch a complete image set for a standard blueprint (cover + all characters + all locations) in under 10 minutes of active run time.
- **SC-004**: 100% of deployment runs for blueprints without images succeed without manual workaround.
- **SC-005**: For deployments with missing image files, 100% of missing assets are explicitly reported while blueprint deployment still completes.
- **SC-006**: In feature acceptance testing, at least 90% of test sessions complete primary gameplay actions (`move to`, `talk to`, blueprint selection) without image-related interruption.
