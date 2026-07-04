# tA1: doc accuracy fixes (blueprint + trace READMEs)

**Type:** build (documentation-only)

**Problem:** Several evaluation docs make claims that contradict the code.
Readers acting on them will be misled about what checks run, what states are
possible, and what the trace runtime actually reveals. Each item below is a
verified doc-vs-code mismatch; fix the doc to match the code (do not change
code).

**Inputs:** none (no upstream task). Independent of tA2; must land before tA3
(tA3 de-duplicates the same files and should operate on corrected content).

**Outcomes** (maps to plan Outcome 1):
- `evaluation/README.md` — the mechanical-checks description (~line 25-28) lists
  exactly the real check set and drops the phantom `mustInclude` and cover-up
  checks. The verified real set:
  `brief_schema_valid, blueprint_schema_valid, culprit_count_matches_brief,
  location_count_matches_brief, character_count_matches_brief,
  red_herring_count_matches_brief, no_orphan_clues, requires_satisfiable`
  (source of truth: `evaluation/checks/mechanical.mjs`).
- `evaluation/README.md` — the analyzer bullet (~line 216) no longer says
  "None are implemented today"; it reflects that `clue_graph` and
  `age_appropriate` have deterministic analyzers
  (`evaluation/checks/analyzers/{clue-graph,age-appropriate}.mjs`), consistent
  with the same file's ~line 248.
- `evaluation/README.md` — the generation-attempt outcome enum (~line 196)
  reads `ok | cli_fail | parse_fail` (verified in
  `evaluation/pipeline/cli-runner.mjs`, outcomes at ~lines 224/243/259), not
  `ok | cli_fail`.
- `evaluation/README.md` — the directory-layout diagram (~line 62-86) is
  brought current: it includes `evaluation/pipeline/{progress.mjs,timing.mjs,
  validate.mjs}`, `evaluation/lib/` (e.g. `readability.mjs`), and
  `evaluation/checks/lib/player-text.mjs`; and the `analyzers/` entry lists
  both `clue-graph.mjs` and `age-appropriate.mjs`.
- `evaluation/trace/README.md` — the bare-search reveal description (~line 124)
  is corrected: a bare search reveals the next not-yet-revealed location clue
  that is **unlocked** (its `requires` prerequisites are already revealed);
  locked clues are skipped. It is not a strict array "prefix". Source of truth:
  `evaluation/trace/lib/mechanical.mjs` (reveal logic ~line 119-126).
- Doc-validation gate passes: every command/path referenced in the edited
  sections is accurate, links resolve, and no stale reference to the old wording
  remains.

**Output artifact:** edits to `evaluation/README.md` and
`evaluation/trace/README.md` only.

**Out of scope:** De-duplication of content shared across docs and
progressive-disclosure fixes (tA3). Any edit to `evaluation/runtime/README.md`
(tA2) or `docs/evaluation-pipeline.md` (tA3). Any code change. Note:
`docs/evaluation-pipeline.md` also states the retry outcome enum incorrectly
(as `ok | cli_fail | schema_fail`) — leave that file to tA3, which owns it.
