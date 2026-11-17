# The labelling page

`./dev eval label` serves one page over every stored game of the truth set
(`evaluation/truth/README.md`, "Labels"). It calls no model.

```bash
./dev eval label                       # the games
./dev eval label <game> [--pass 2 | --reported]   # a game's pass
```

**Who labels.** Each visitor picks a name (a cookie) their labels record.
`--by <name>` labels as that name until a visitor picks one. Names are handles
(letters, digits, `.`, `-`, `_`): the label files are public.

**The list.** Each game shows its blueprint, target age, persona, when it was
played and last labelled, and its stage: not started, pass 1 in progress, pass
1 done without judge results, pass 2 with turns left, or done. Search by words,
stage and dates; sort by date.

**Passes.**

- *Pass 1*: every turn, no judge finding.
- *Reported turns*: pass 1 limited to the turns a failing verdict's finding
  points at; offered once results judge the game or a variant.
- *Pass 2*: only the turns where a judge and the label disagree, with those
  verdicts (a clean `not_age_fit` label is never questioned); offered once
  every turn has a label and results judge the game. Its labels record pass 2.

Nothing a judge said shows until pass 1 is complete. Saves append to
`labels.json` at once; a pass resumes at its first unanswered turn. Games and
results are read at start: restart after adding either.

**A turn.** The title gives the game, target age, pass and place, and opens
the ground truth with every character's profile over the page; a conversation
turn opens its character's. Each fault is a row with its own kind, severity
and note; no row means clean.

**Keys.** `a` adds a row; 1 to 5 set its kind, `n`/`m` its severity, `t` its
note (Escape leaves), `x` removes it. Enter saves, `c` saves clean, `p` goes
back, `g` opens the ground truth.

## From a phone, over Tailscale

The server listens on the loopback address only. `--tailscale` answers to this
machine's tailnet name and listens on port 52400 unless `--port` says otherwise:

```bash
./dev eval label --tailscale
tailscale serve --bg 52400      # once; `tailscale serve reset` undoes it
```

Then open `https://<machine>.<tailnet>.ts.net/` in the tailnet. Labels land in
this checkout: commit them and regenerate the score table.

Code: `server.ts` (routes, names, hosts), `hub.ts` (passes, stages), `home.ts`,
`page.ts`, `turns.ts`, `store.ts` (the label file), `keys.ts`;
`evaluation/core/tailscale.ts`.
