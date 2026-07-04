# tB1: runtime npm scripts + top-level discoverability

**Type:** build (non-documentation — touches `package.json`; gate = `npm test`)

**Problem:** The blueprint and trace pipelines are reachable via npm scripts
(`eval`, `eval:trace`, `eval:trace:extract`) and surfaced in `CLAUDE.md` /
`QUICKSTART.md`. The runtime harness (`evaluation/runtime/`) has **no npm
scripts** — its README drives it with raw `node evaluation/runtime/run.mjs …`
invocations — and it is absent from the top-level pointers. It is therefore
undiscoverable next to its two peers. This card gives the runtime harness parity
so all three pipelines are discoverable from one entry point.

**Inputs:** none (no upstream task). Enables tB2 (the runbook uses the new
script names).

**Outcomes** (maps to plan Outcome 2):
- `package.json` adds three scripts wrapping the existing runtime entrypoints:
  - `eval:runtime` → `node evaluation/runtime/run.mjs`
  - `eval:runtime:rejudge` → `node evaluation/runtime/rejudge.mjs`
  - `eval:cases-from-trace` → `node evaluation/runtime/cases-from-trace.mjs`
  Each must accept pass-through flags after `--` exactly as the underlying
  script does today (verify each script's arg parsing still works when invoked
  via the npm wrapper).
- `CLAUDE.md`'s evaluation task-loading pointer (the eval bullet under
  "Task-Specific Loading Rules", ~line 91-100) references all three pipelines
  including `evaluation/runtime/README.md`, which it currently omits.
- `QUICKSTART.md` gains an evaluation entry (or extends an existing section) that
  names all three pipelines and their npm scripts, including the new runtime
  ones, so a reader can find them without reading source.
- The full quality gate passes (`npm test`). This is a non-doc change (adds
  scripts + touches `package.json`); the change touches only `package.json`,
  `CLAUDE.md`, and `QUICKSTART.md` and runs cleanly in the Phase 1 unit gate.

**Output artifact:** three new scripts in `package.json` (`eval:runtime`,
`eval:runtime:rejudge`, `eval:cases-from-trace`); updated eval pointer in
`CLAUDE.md`; an evaluation-discoverability entry in `QUICKSTART.md`.

**Out of scope:** Documenting the flags/defaults of the runtime scripts inside
`evaluation/runtime/README.md` (tA2). The end-to-end runbook (tB2). Any change
to the runtime scripts' behavior — this card only wraps and surfaces them.
