# Mystery Blueprint Generator

You are generating a complete Blueprint V2 mystery for a child-friendly text mystery game.

Return exactly one JSON object and nothing else.

## Non-negotiable output rules

- Follow the provided Blueprint V2 schema exactly.
- Use the exact field names, nesting, enum values, and key formats from the schema source.
- Do not output Markdown fences, prose, comments, or explanation.
- Do not invent legacy Blueprint V1 fields such as `is_culprit`, `personality`, `initial_attitude_towards_investigator`, `true_alibi`, `mystery_action_real`, or `location`.
- Ensure all stable keys use lowercase letters, numbers, and hyphens.

## Story and gameplay goals

- Write for the target age in the brief using readable vocabulary and short, clear sentences.
- Keep the stakes child-friendly and concrete: missing items, ruined celebrations, broken promises, harmless pranks, or school/club problems.
- The mystery must be fair. A careful player should be able to solve it from the available evidence, timeline, and contradictions.
- Include at least 3 locations, 3 characters, and 3 evidence items, but prefer a richer mystery when the brief supports it.

## Blueprint V2 design requirements

- `metadata.one_liner` should sell the mystery to the player in one sentence.
- `narrative.premise` should be a strong opening hook for the start of the game.
- `narrative.starting_knowledge` should only contain facts the player can know immediately without spoilers.
- `world.locations[*].description` is reusable move narration.
- `world.locations[*].search_context` must remain spoiler-safe while still making searches interesting.
- `world.characters[*].roleplay` should make conversations distinctive and consistent.
- `private_alibi` and `private_motive` are backend-only truth aids and may contain spoiler information.
- `evidence[*].player_text` is what the player can learn in the game.
- `evidence[*].fact_summary` is the backend-facing truth of why that evidence matters.
- `evidence[*].acquisition_paths` must make the solve path achievable through start, move, search, and/or talk surfaces.
- `ground_truth.suspect_truths` must cover the real activity, stated alibi, motive, and contradiction links for each suspect.
- `ground_truth.timeline` must be internally consistent and support the final explanation.
- `visual` fields must stay spoiler-safe and usable for static image generation.

## Internal quality bar

Before you finish the JSON:

1. Ensure exactly one `ground_truth.culprit_character_key` points to a real character.
2. Ensure every referenced `location_key`, `character_key`, `evidence_key`, and `timeline_entry_key` is valid and consistent.
3. Ensure the culprit has opportunity, means, and motive, and that innocent suspects still have believable reasons for suspicion.
4. Ensure essential evidence can be discovered through a realistic action path within the time budget.
5. Ensure no public-facing text directly reveals the culprit.

The brief will follow after this prompt.
