"""Prototype clue graph: checks, character state, leads, a scripted play, and a drawing.

Usage: python3 -I graph.py pumpkin.graph.json out.html
"""
import html
import json
import sys

G = json.load(open(sys.argv[1]))
CLUES, CHARS, CONC = G["clues"], G["characters"], G["conclusions"]


def source(c):
    return c["from"].get("talk") or "search"


def is_gated(c):
    return "gate" in c


def riders(cid):
    return [k for k, c in CLUES.items() if c.get("rides_on") == cid]


def rule_met(rule, held):
    if isinstance(rule, str):
        return rule in held or (rule in CONC and rule_met(CONC[rule]["rule"], held))
    if "all" in rule:
        return all(rule_met(r, held) for r in rule["all"])
    return any(rule_met(r, held) for r in rule["any"])


def rule_leaves(rule):
    if isinstance(rule, str):
        return rule_leaves(CONC[rule]["rule"]) if rule in CONC else [rule]
    return [leaf for r in rule.get("all", rule.get("any", [])) for leaf in rule_leaves(r)]


# ---------------------------------------------------------------- checks

def reachable():
    """Clues a player can reach with no luck: each has a prompt they already hold."""
    got, how = set(), {}
    grew = True
    while grew:
        grew = False
        for cid, c in CLUES.items():
            if cid in got:
                continue
            why = None
            if "search" in c["from"]:
                spot = c["from"].get("spot")
                why = f"search {spot}" if spot else "plain search"
            elif c.get("rides_on"):
                if c["rides_on"] in got:
                    why = f"shows with {c['rides_on']}"
            elif c.get("give") == "volunteer":
                why = "said on first meeting"
            elif c.get("give") == "ask":
                prompts = [p for p in c["prompted_by"] if p == "public" or p in got]
                if prompts:
                    why = f"ask about {c['topic']} (prompted by {', '.join(prompts)})"
            elif is_gated(c):
                g = c["gate"]
                if all(a in got for a in g.get("after", [])):
                    shown = [u for u in g.get("use", {}).get("any", []) if u in got]
                    if shown:
                        why = f"show {' or '.join(shown)}"
                    elif "line" in g and g.get("hinted_by") in got:
                        why = f"line of questioning (hinted by {g['hinted_by']})"
                    elif "use" not in g and "line" not in g:
                        why = f"asked once {' and '.join(g['after'])} are out"
            if why:
                got.add(cid)
                how[cid] = why
                grew = True
    return got, how


def checks():
    got, how = reachable()
    problems = []
    for cid, c in CLUES.items():
        if cid not in got:
            problems.append(f"{cid}: no way to reach it without luck")
        if c.get("kind") == "statement" and c.get("true") is False:
            cracks = [k for k, x in CLUES.items() if cid in x.get("retracts", []) and k in got]
            if not cracks:
                problems.append(f"{cid}: a false statement nothing takes back")
        g = c.get("gate", {})
        if "line" in g and "hinted_by" not in g:
            problems.append(f"{cid}: a worded gate with no reaction clue hinting at it")
        if c.get("kind") == "reaction" and not (c.get("rides_on") or c.get("give")):
            problems.append(f"{cid}: a reaction with nothing that shows it")
    for kid, k in CONC.items():
        if not rule_met(k["rule"], got):
            problems.append(f"{kid}: conclusion cannot be reached")
    suspects = [cid for cid, ch in CHARS.items() if ch.get("suspect") and not ch.get("culprit")]
    cleared = {k.get("clears") for k in CONC.values()}
    return got, how, problems, [s for s in suspects if s not in cleared]


# ---------------------------------------------------------------- play

class Play:
    def __init__(self):
        self.held, self.retracted, self.met = [], set(), set()
        self.at, self.turns, self.log = G["start"], 0, []

    def give(self, ids, note):
        new = []
        for cid in ids:
            for x in [cid] + riders(cid):
                if x not in self.held:
                    self.held.append(x)
                    new.append(x)
                    self.retracted |= set(CLUES[x].get("retracts", []))
        self.log.append({"note": note, "turns": self.turns, "new": new, "leads": self.leads(),
                         "concluded": [k for k, v in CONC.items() if rule_met(v["rule"], self.live())]})

    def live(self):
        return [c for c in self.held if c not in self.retracted]

    def move(self, loc):
        self.at, self.turns = loc, self.turns + 1
        self.give([], f"move to {G['locations'][loc]['name']}")

    def search(self, spot=None):
        self.turns += 1
        found = [k for k, c in CLUES.items() if c["from"].get("search") == self.at and c["from"].get("spot") == spot]
        self.give(found, f"search {spot or '(plain)'}")

    def talk(self, who):
        assert CHARS[who]["at"] == self.at, who
        self.turns += 1
        self.met.add(who)
        self.give([k for k, c in CLUES.items() if source(c) == who and c.get("give") == "volunteer"], f"talk to {CHARS[who]['name']}")

    def ask(self, who, cid):
        self.give([cid], f"ask {CHARS[who]['name']} about {CLUES[cid].get('topic', 'what really happened')}")

    def use(self, who, shown, line=False):
        opened = []
        for cid in available(who, self.held):
            g = CLUES[cid]["gate"]
            if set(shown) & set(g.get("use", {}).get("any", [])) or (line and "line" in g):
                opened.append(cid)
        self.give(opened, f"show {CHARS[who]['name']}: {', '.join(shown) if shown else 'the line of questioning'}")

    def leads(self):
        out = []
        for who, ch in CHARS.items():
            if who not in self.met:
                out.append(f"You have not talked to {ch['name']} yet.")
                continue
            hot = False
            for cid, c in CLUES.items():
                if source(c) != who or cid in self.held:
                    continue
                if c.get("give") == "ask":
                    hot |= any(p in self.held for p in c["prompted_by"] if p != "public")
                elif cid in available(who, self.held):
                    g = c["gate"]
                    hot |= bool(set(g.get("use", {}).get("any", [])) & set(self.held))
                    hot |= "line" in g and g.get("hinted_by") in self.held
                    hot |= "use" not in g and "line" not in g
            if hot:
                out.append(f"{ch['name']} may know more.")
        return out


def available(who, held):
    """This character's gated clues whose turn has come: earlier steps are out."""
    return [cid for cid, c in CLUES.items() if source(c) == who and is_gated(c) and cid not in held
            and all(a in held for a in c["gate"].get("after", []))]


def state(who, play):
    """What the narrator is given to play this character this turn. Derived, never authored."""
    ch, held = CHARS[who], play.held
    mine = {k: c for k, c in CLUES.items() if source(c) == who}
    gated = [k for k, c in mine.items() if is_gated(c)]
    opened = [k for k in gated if k in held]
    avail = available(who, held)
    last_step = [k for k in avail if "use" not in mine[k]["gate"] and "line" not in mine[k]["gate"]]
    lies = [k for k, c in mine.items() if c.get("true") is False and (k in held or c.get("give") == "volunteer")]
    standing = [k for k in lies if k not in play.retracted]
    if not lies:
        stance = "open"
    elif not standing:
        stance = "cleared"
    elif last_step:
        stance = "cornered"
    elif len(standing) < len(lies):
        stance = "shaken"
    else:
        stance = "guarded"
    order = ["cleared", "cornered", "shaken", "guarded", "open"]
    demeanor = next(ch["demeanor"][s] for s in order[order.index(stance):] + order if s in ch["demeanor"])
    out = {
        "stance": stance,
        "demeanor": demeanor,
        "says_first": [mine[k]["text"] for k in mine if mine[k].get("give") == "volunteer" and k not in held],
        "answers_if_asked": [{"id": k, "about": mine[k]["topic"], "says": mine[k]["text"]} for k in mine if mine[k].get("give") == "ask" and k not in held],
        "gives_when_shown": [],
        "story_so_far": [("TAKEN BACK: " if k in play.retracted else "") + mine[k]["text"] for k in held if k in mine and mine[k].get("kind") == "statement"],
        "keeps_back": [],
    }
    for k in avail:
        g = mine[k]["gate"]
        shows = [("holds " if u in held else "does not hold ") + u for u in g.get("use", {}).get("any", [])]
        if "line" in g:
            shows.append("or: " + g["line"])
        if not shows:
            shows = ["asked plainly what really happened"]
        out["gives_when_shown"].append({"id": k, "when": shows, "says": mine[k]["text"],
                                         "with": [CLUES[r]["text"] for r in riders(k)],
                                         "takes_back": [mine[r]["text"] for r in mine[k].get("retracts", []) if r in mine]})
    for k in gated:
        if k not in held and k not in avail:
            out["keeps_back"].append(mine[k]["text"])
    return out


def scripted_play():
    p, snaps = Play(), {}
    p.search("the broken side window")
    p.search("the smashed pumpkin")
    p.search()
    p.move("potting_shed")
    snaps["Toby, before the first word"] = state("toby", p)
    p.talk("toby")
    snaps["Toby, after hello (the player holds the glass and the welly prints)"] = state("toby", p)
    p.use("toby", ["clue_glass_outside"])
    p.use("toby", ["clue_welly_prints"])
    snaps["Toby, after both are shown to him"] = state("toby", p)
    p.talk("mia")
    p.move("thorne_garden")
    p.talk("thorne")
    snaps["Mr. Thorne, after hello (the player holds the boot prints)"] = state("thorne", p)
    p.use("thorne", ["clue_boot_prints"])
    p.move("workshop")
    p.talk("dobbs")
    p.ask("dobbs", "clue_dobbs_crash_time")
    p.move("potting_shed")
    p.talk("toby")
    p.use("toby", ["clue_thorne_mia_cake"])
    snaps["Toby, once he has taken back blaming Mia"] = state("toby", p)
    p.ask("toby", "toby_confession")
    snaps["Toby, after the confession"] = state("toby", p)
    return p, snaps


# ---------------------------------------------------------------- drawing

COLS = ["search", "hale", "toby", "mia", "dobbs", "thorne", "conclusions"]
BOX_W, BOX_H, COL_W, ROW_H, TOP = 150, 34, 178, 46, 60


def short(cid):
    return cid.replace("clue_", "").replace("react_", "~ ").replace("_", " ")


def draw():
    pos, parts = {}, []
    rows = {c: 0 for c in COLS}
    for cid, c in CLUES.items():
        col = source(c)
        pos[cid] = (COLS.index(col) * COL_W + 14, TOP + rows[col] * ROW_H)
        rows[col] += 1
    for kid in CONC:
        pos[kid] = (COLS.index("conclusions") * COL_W + 14, TOP + rows["conclusions"] * ROW_H)
        rows["conclusions"] += 1
    height = TOP + max(rows.values()) * ROW_H + 20
    width = len(COLS) * COL_W + 14

    def edge(a, b, cls):
        (ax, ay), (bx, by) = pos[a], pos[b]
        if ax <= bx:
            x1, x2 = ax + BOX_W, bx
        else:
            x1, x2 = ax, bx + BOX_W
        if ax == bx:
            x1 = x2 = ax + BOX_W
            parts.append(f'<path class="e {cls}" d="M{x1} {ay + BOX_H / 2} C{x1 + 26} {ay + BOX_H / 2} {x1 + 26} {by + BOX_H / 2} {x2} {by + BOX_H / 2}"/>')
            return
        mid = (x1 + x2) / 2
        parts.append(f'<path class="e {cls}" d="M{x1} {ay + BOX_H / 2} C{mid} {ay + BOX_H / 2} {mid} {by + BOX_H / 2} {x2} {by + BOX_H / 2}"/>')

    for cid, c in CLUES.items():
        g = c.get("gate", {})
        for u in g.get("use", {}).get("any", []):
            edge(u, cid, "use")
        for a in g.get("after", []):
            edge(a, cid, "after")
        for r in c.get("retracts", []):
            edge(cid, r, "retract")
        for p in c.get("prompted_by", []):
            if p != "public":
                edge(p, cid, "prompt")
        if g.get("hinted_by"):
            edge(g["hinted_by"], cid, "prompt")
    for kid, k in CONC.items():
        def direct(rule):
            if isinstance(rule, str):
                return [rule]
            return [x for r in rule.get("all", rule.get("any", [])) for x in direct(r)]
        for leaf in dict.fromkeys(direct(k["rule"])):
            edge(leaf, kid, "rule")

    for i, col in enumerate(COLS):
        name = CHARS[col]["name"] if col in CHARS else col.capitalize()
        parts.append(f'<text class="col" x="{i * COL_W + 14 + BOX_W / 2}" y="34">{html.escape(name)}</text>')
    for nid, (x, y) in pos.items():
        c = CLUES.get(nid)
        if c is None:
            cls = "conclusion"
        elif c.get("kind") == "reaction":
            cls = "reaction"
        elif c.get("true") is False:
            cls = "false"
        elif c.get("kind") == "statement":
            cls = "statement"
        else:
            cls = "evidence"
        tip = html.escape((c or CONC[nid])["text"])
        mark = " *" if c and (is_gated(c)) else ""
        parts.append(f'<g><title>{tip}</title><rect class="n {cls}" x="{x}" y="{y}" width="{BOX_W}" height="{BOX_H}" rx="6"/>'
                     f'<text class="lbl" x="{x + BOX_W / 2}" y="{y + BOX_H / 2 + 4}">{html.escape(short(nid))}{mark}</text></g>')
    return f'<svg viewBox="0 0 {width} {height}" width="100%">{"".join(parts)}</svg>'


def esc(x):
    return html.escape(str(x))


def render(out):
    got, how, problems, uncleared = checks()
    play, snaps = scripted_play()
    h = ['<!doctype html><meta charset="utf-8"><title>Clue graph prototype</title><style>',
         'body{font:14px/1.45 -apple-system,Segoe UI,sans-serif;max-width:1280px;margin:24px auto;padding:0 16px;color:#1c1c1c}',
         'h1{font-size:22px}h2{font-size:17px;margin-top:32px;border-bottom:1px solid #ddd;padding-bottom:4px}h3{font-size:14px;margin:18px 0 4px}',
         'table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #ddd;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f5f5f3}',
         '.n{stroke-width:1.3}.evidence{fill:#f0efec;stroke:#8a8a86}.statement{fill:#e7f1fb;stroke:#4a7fb5}.false{fill:#fbebeb;stroke:#c0392b;stroke-width:2}',
         '.reaction{fill:#f9eeda;stroke:#b8862b}.conclusion{fill:#e5f4e4;stroke:#3c8a3a}.lbl{font-size:10.5px;text-anchor:middle;fill:#1c1c1c}',
         '.col{font-size:13px;font-weight:600;text-anchor:middle}.e{fill:none;stroke-width:1.2;opacity:.75}.use{stroke:#333}.after{stroke:#333;stroke-dasharray:2 3}',
         '.retract{stroke:#c0392b;stroke-dasharray:6 3;stroke-width:1.6}.prompt{stroke:#b8862b;stroke-dasharray:1 3}.rule{stroke:#3c8a3a}',
         '.key span{display:inline-block;margin-right:14px}.sw{display:inline-block;width:12px;height:12px;border:1.5px solid;vertical-align:-2px;margin-right:4px}',
         'pre{background:#f7f7f5;padding:10px;overflow:auto;font-size:12px}.ok{color:#2e7d32}.bad{color:#c0392b}small{color:#666}</style>']
    h.append(f'<h1>{esc(G["title"])} as a clue graph</h1><p>Rewritten by hand from <code>{esc(G["source"])}</code>. '
             f'{len(CLUES)} clues, {sum(is_gated(c) for c in CLUES.values())} gated, {len(CONC)} conclusions. Hover a box for its text.</p>')
    h.append('<p class="key"><span><i class="sw" style="background:#f0efec;border-color:#8a8a86"></i>found by searching</span>'
             '<span><i class="sw" style="background:#e7f1fb;border-color:#4a7fb5"></i>true statement</span>'
             '<span><i class="sw" style="background:#fbebeb;border-color:#c0392b"></i>false statement</span>'
             '<span><i class="sw" style="background:#f9eeda;border-color:#b8862b"></i>reaction clue</span>'
             '<span><i class="sw" style="background:#e5f4e4;border-color:#3c8a3a"></i>conclusion</span>'
             '<span>* gated</span><span>black: show this to open that</span><span>red dashed: takes back</span>'
             '<span>yellow dotted: prompts the question</span><span>green: supports</span></p>')
    h.append(draw())

    h.append('<h2>Checks</h2>')
    if problems:
        h.append('<ul>' + ''.join(f'<li class="bad">{esc(p)}</li>' for p in problems) + '</ul>')
    else:
        h.append('<p class="ok">Every clue can be reached without luck. Every false statement has a clue that takes it back. Every worded gate is hinted. Every conclusion can be reached.</p>')
    if uncleared:
        h.append(f'<p class="bad">No conclusion clears: {esc(", ".join(uncleared))}</p>')

    h.append('<h2>How the player reaches each clue</h2><table><tr><th>Clue</th><th>From</th><th>Reached by</th><th>Text</th></tr>')
    for cid, c in CLUES.items():
        who = CHARS[source(c)]["name"] if source(c) in CHARS else G["locations"][c["from"]["search"]]["name"]
        kind = "false statement" if c.get("true") is False else c.get("kind", "evidence")
        h.append(f'<tr><td>{esc(short(cid))}<br><small>{kind}{" · new" if c.get("origin") else ""}{" · " + esc(c["origin"]) if c.get("origin") else ""}</small></td><td>{esc(who)}</td><td>{esc(how.get(cid, "UNREACHABLE"))}</td><td>{esc(c["text"])}</td></tr>')
    h.append('</table>')

    h.append('<h2>Conclusions</h2><table><tr><th>Conclusion</th><th>Rests on</th></tr>')
    for kid, k in CONC.items():
        h.append(f'<tr><td>{esc(k["text"])}</td><td><code>{esc(json.dumps(k["rule"]))}</code></td></tr>')
    h.append('</table>')

    h.append(f'<h2>A scripted play ({play.turns} turns)</h2><table><tr><th>Turn</th><th>Action</th><th>New in the notebook</th><th>Leads shown</th><th>Now supported</th></tr>')
    seen = set()
    for step in play.log:
        fresh = [k for k in step["concluded"] if k not in seen]
        seen |= set(step["concluded"])
        h.append(f'<tr><td>{step["turns"]}</td><td>{esc(step["note"])}</td><td>{"<br>".join(esc(short(n)) for n in step["new"])}</td>'
                 f'<td>{"<br>".join(esc(l) for l in step["leads"])}</td><td>{"<br>".join(esc(short(f)) for f in fresh)}</td></tr>')
    h.append('</table><p><small>"Now supported" is never shown to the player. It is what the accusation judge and the lead computation see.</small></p>')

    h.append('<h2>Character state, derived from the graph</h2><p>This is the whole talk input for the character on that turn, besides personality and reading level.</p>')
    for title, s in snaps.items():
        h.append(f'<h3>{esc(title)}</h3><pre>{esc(json.dumps(s, indent=2, ensure_ascii=False))}</pre>')
    open(out, "w").write("".join(h))
    return problems, uncleared, play, snaps


if __name__ == "__main__":
    problems, uncleared, play, snaps = render(sys.argv[2])
    print("problems:", problems or "none")
    print("suspects with no clearing conclusion:", uncleared or "none")
    print("turns:", play.turns, "| held:", len(play.held), "| retracted:", sorted(play.retracted))
    for step in play.log:
        print(f'{step["turns"]:>2} {step["note"]:<58} +{len(step["new"])} leads={[l.split(" may")[0].replace("You have not talked to ", "!") for l in step["leads"]]}')
    for title in list(snaps)[:3]:
        print("\n##", title)
        print(json.dumps(snaps[title], indent=1, ensure_ascii=False))
