# The labelling page

`./dev eval label` serves one page over every stored game of the truth set
(`evaluation/truth/README.md`, "Labels"). It calls no model and needs no key.
Stop it with Ctrl-C.

```bash
./dev eval label                       # the list of games
./dev eval label <game> [--pass 2 | --reported]   # straight to a game's pass
```

**Who labels.** Each visitor picks a name, kept in a cookie; every label they
save records it. `--by <name>` labels as that name until a visitor picks one.
Names are handles (letters, digits, `.`, `-`, `_`): the label files are public.

**The list.** Each game shows its blueprint, persona, when it was played and
last labelled, and its stage: not started, pass 1 in progress, pass 1 done
with no judge results, pass 2 with the turns left to answer, or done. Search by
words, stage, and a range of either date, and sort by either.

**Passes.**

- *Pass 1*: every turn, no judge finding.
- *Reported turns*: pass 1 limited to the turns a failing verdict's finding
  points at; offered once stored results judge the game or a variant.
- *Pass 2*: only the turns where a judge and the label disagree, with those
  verdicts; offered once every turn has a label and stored results judge the
  game. Its labels record pass 2.

The list shows nothing a judge said until pass 1 is complete. Saves append to
`labels.json` at once; a pass resumes at its first unanswered turn. Games and
judge results are read at start: restart after adding either.

**Keys.** 1 to 5 tick a kind, `n`/`m` the severity, `t` the note (Escape
leaves it), Enter saves, `c` saves clean, `p` goes back. On a touch
screen the kinds are buttons and the save stays at the bottom.

## From a phone, over Tailscale

The server listens on the loopback address only. `--tailscale` asks
`tailscale status` for this machine's tailnet name, answers to it, and listens
on port 52400 unless `--port` says otherwise:

```bash
./dev eval label --tailscale
tailscale serve --bg 52400      # once; `tailscale serve reset` undoes it
```

Then open `https://<machine>.<tailnet>.ts.net/` on any device in the tailnet.
Labels land in this checkout: commit them and regenerate the score table.

Code: `server.ts` (routes, names, hosts), `hub.ts` (games, passes, stages),
`home.ts`, `page.ts`, `store.ts` (the label file), `keys.ts`;
`evaluation/core/tailscale.ts` finds the tailnet name.
