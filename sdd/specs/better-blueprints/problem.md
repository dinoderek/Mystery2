# Problem Definition

As we are refining the game mechanics and we're adding image support, we need to improve our mystery blueprints so that the stories are more compelling, coherent and images and text tie together.

## What I'm Building

1. A tool to generate new blueprints from a user provided brief. 
2. Improved prompting and/or schema documentation for the blueprint generation that gives the AI more guidance on (1) how the blueprint is used, (2) how each section of the blueprint should be generated
3. A tool to verify that blueprints are of good enough quality, in particular from a consistency and information depth point of view. 

## Who It's For

As a blueprint author I want to be able to create good quality blueprints quickly.
As an investigator, I want the mysteries to be consistent and high quality across text and images.

## Why It Matters

Currently:
* Text in the blueprint is inconsistent - for example initial narrative vs actual characters and locations
* The blueprint does not provide enough information to generate good quality images for locations and characters

## Known Constraints

- The player UI remains a static SvelteKit client. Blueprint generation, verification, and any secret-bearing AI work must stay in backend or operator tooling rather than the browser.
- Blueprints are stored as JSON in the Supabase Storage `blueprints` bucket and reparsed by multiple Edge Functions and scripts, so schema changes have a broad runtime blast radius.
- Default quality gates must remain deterministic and align with `docs/testing.md`; live-model evaluation is allowed only as an opt-in workflow.
- Blueprint changes must preserve spoiler boundaries between player-visible text/images and full ground truth used only in protected backend flows.

## Existing Context

Beyond the standard context I believe the following is highly relevant: 

* We recently added image generation. The prompts for image generation are NOT final, but we should ensure that we have enough information in the blueprint to (1) establish the overall feel of the art, (2) generate location art, (3) generate character art. We might need dedicated description to feed into the image generator but they should consistent with the overall description of the character..
* We have known bugs in the current blueprints - in particular that "introductory text" for the blueprint does not match the mystery / characters / lcoations.
* We do not need to maintain backwards compatibility. Larger structural changes are acceptable if they materially improve blueprint quality, verification strength, and text/image consistency.
* The generation and verification logic should be designed as reusable TypeScript libraries first, with local tooling as the first consumer and a backend move left open for later.


## What Good Looks Like

* Blueprints contain enough information to generate quality images for the blueprint, for locations and for characters.
* All the text and images for the blueprint are consistent between each other. 
* Text and images of the blueprint do not leak the solution to the mystery.
* The mystery is always solvable in no more than 75% of the available time.
* Blueprints have clear and consistent identifier semantics for characters and locations, without ambiguous duplicate reference fields.
* Blueprints include a spoiler-safe visual layer that supports cover, location, and character image generation without leaking solution-only information.
* We have created a verification oracle that can, with good accuracy, determine if the conditions above hold.
* The verification oracle is hybrid: deterministic checks act as the required gate, and AI-based evaluation provides advisory quality scoring for coherence, spoiler risk, and image readiness.
* As a future development, not in scope now, I want to create an evaluation harness to determine perforamnce of model and prompts in generating blueprints. Keep it in mind while designing the oracle.

## What I Don't Want

* Limit the scope ONLY to blueprint generation changes - If blueprint format needs to change then make the minimal changes that are necesary to keep the game functional. 
* Do not create an evaluation harness for blueprint generation.
* Preserve backwards compatibility with the old blueprint format.

## Research Threads

1. **Project context**: What do the existing architecture, codebase, and documentation tell us about how to build this? What patterns are established? What constraints apply?
2. **Codebase impact**: What files, modules, database tables, and tests will be affected? What's the blast radius?
3. **Current Blueprint generation**: Investigate current blueprint generation infrastructure and prompts. I believe we just have a prompt and the schema. Identify low hanging improvements to schema and prompt that could be added to increase AI performance when generating blueprints. 
4. **Image generation**: Identify what improvments can be fone to the blueprint schema to support improved image generation.
5. **Blueprint evaluation oracle**: Determine how we could create the verification oracle to evaluate blueprints. Contrast deterministic with AI based. 
