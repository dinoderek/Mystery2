# Docs: what the gate checks

- **Curated extracts.** Editing an `<!-- extract:<id> -->` section fails
  `curated-docs` until its extract is reviewed and re-hashed.
- **References must exist.** A path, `npm run` script or relative link that
  does not exist fails `doc-refs`.
- **Word budgets.** Every `.md` needs a row in `docs/word-budgets.tsv`.
  Raising a budget is the operator's decision; trim instead.
- **One owner per topic.** Link to the owning doc; do not restate it.

Detail: `docs/testing.md`.
