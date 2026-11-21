"""Spike: does a live narrator play a turn well from the derived character state?"""
import json, subprocess, sys, tempfile, concurrent.futures as cf
sys.argv = ["x", "pumpkin.graph.json", "/dev/null"]
exec(open("graph.py").read().replace('if __name__ == "__main__":', 'if False:'))

SYSTEM = """You play {name} for one turn of a conversation in a mystery game for children aged about ten.

What the game is for: a child who does real detective work is rewarded at once. Be generous about how they say a thing, and strict about whether they have anything.

Your notes are the JSON below. They are everything you know this turn.
- "gives_when_shown" lists what you give up, and what opens each one. If the investigator's line shows you one of those things, or makes its point at you, however clumsily or misspelled, it opens: say what it "says" this turn in your own voice, show anything under "with", and stop claiming what it "takes_back". If they showed it earlier in this conversation and you dodged, a follow-up question about it opens it too. A specific, believable bluff opens it even when they do not hold the thing.
- If their line shows you nothing (pushing, insisting, accusing, kindness, small talk, or only a word on the subject), nothing opens. Stay in your stance, and keep to "story_so_far".
- "answers_if_asked": say it when they ask about that subject.
- "says_first": on a first meeting, work these in.
- Never say or hint at anything in "keeps_back". Never contradict "story_so_far", except lines marked TAKEN BACK.
- "stance" and "demeanor" are how you feel and carry yourself right now.

Speak in the first person with one small action beat. Two to four short sentences, easy words. Do not invent facts.

Return JSON: "narration"; "opened", the ids from gives_when_shown that opened this turn; "asked", the ids from answers_if_asked you answered this turn.

Personality: {personality}

Notes:
{notes}"""
SCHEMA = {"type": "object", "properties": {"narration": {"type": "string"}, "opened": {"type": "array", "items": {"type": "string"}}, "asked": {"type": "array", "items": {"type": "string"}}}, "required": ["narration", "opened", "asked"], "additionalProperties": False}

def base():
    p = Play(); p.search("the broken side window"); p.search("the smashed pumpkin"); p.search(); return p
def toby_met():
    p = base(); p.move("potting_shed"); p.talk("toby"); return p
def toby_shaken():
    p = toby_met(); p.use("toby", ["clue_glass_outside"]); p.use("toby", ["clue_welly_prints"]); return p
def toby_cornered():
    p = toby_shaken(); p.move("thorne_garden"); p.talk("thorne"); p.move("potting_shed"); p.talk("toby"); p.use("toby", ["clue_thorne_mia_cake"]); return p
def thorne_met():
    p = toby_met(); p.move("thorne_garden"); p.talk("thorne"); return p
def dobbs_met():
    p = base(); p.move("workshop"); p.talk("dobbs"); return p
def hale_guarded():
    p = base(); p.search("the toppled bench"); p.move("potting_shed"); p.search("the watering rota on the door"); p.move("greenhouse"); p.talk("hale"); p.use("hale", ["clue_rota_purple_ink"]); return p
def toby_first():
    p = base(); p.move("potting_shed"); return p

DODGE = [("investigator", "toby the glass from the window was OUTSIDE on the path not inside"), ("Toby", "Toby sweeps faster. \"Glass goes everywhere when a window breaks. Have you looked at Mr. Thorne's ladder yet?\"")]
CASES = [
 ("shown", "toby-glass-plain", "toby", toby_met, [], "The glass from the window is outside on the path, not inside! So nobody climbed in.", ["toby_drops_burglar"], []),
 ("shown", "toby-welly-kid", "toby", toby_met, [], "toby why r there welly prints with leafs on in the pumpkin mush??", ["toby_blames_mia"], []),
 ("shown", "thorne-boot-prints", "thorne", thorne_met, [], "There are huge boot prints in the flower bed by your fence. Are they yours?", ["clue_thorne_measured"], []),
 ("shown", "thorne-what-toby-said", "thorne", thorne_met, [], "toby says u were up ur ladder with a tape measure saying enjoy her while she lasts", ["thorne_ladder_thursday"], []),
 ("shown", "hale-bench-accident", "hale", hale_guarded, [], "The bench had a rotten leg and it snapped. Maybe it was an accident?", ["clue_hale_toby_upset"], []),
 ("line", "hale-promise-fair", "hale", hale_guarded, [], "I promise I will be fair to Toby. I only want to know what really happened.", ["clue_hale_toby_upset"], []),
 ("after-dodge", "toby-glass-follow-up", "toby", toby_met, DODGE, "so did someone climb in or not??", ["toby_drops_burglar"], []),
 ("last-step", "toby-confession", "toby", toby_cornered, [], "toby what really happened?", ["toby_confession"], []),
 ("asked", "dobbs-noise", "dobbs", dobbs_met, [], "What did you hear last night?", [], ["clue_dobbs_crash_time"]),
 ("asked", "toby-key", "toby", toby_met, [], "have you seen the greenhouse key?", [], ["toby_no_key"]),
 ("hold-push", "toby-just-tell-me", "toby", toby_met, [], "i think u did it!! just tell me the truth toby i wont be mad", [], []),
 ("hold-push", "toby-shaken-it-was-you", "toby", toby_shaken, [], "it wasnt mia!! it was YOU toby!!", [], []),
 ("hold-push", "thorne-accused", "thorne", thorne_met, [], "You smashed Bertha so Goliath would win!", [], []),
 ("hold-push", "hale-accuse-toby", "hale", hale_guarded, [], "toby did it didnt he!! tell me!!", [], []),
 ("hold-topic", "toby-window-word", "toby", toby_met, [], "is the window broken?", [], []),
 ("hold-topic", "dobbs-small-talk", "dobbs", dobbs_met, [], "Do you like being the caretaker?", [], []),
 ("bluff", "toby-rota-bluff", "toby", toby_met, [], "I saw the rota. Mia's name is written over yours in purple pen!", ["clue_toby_mia_splat"], []),
 ("first-meeting", "toby-hello", "toby", toby_first, [], "hi toby", [], []),
]

def call(model, case):
    group, cid, who, setup, history, line, want_open, want_ask = case
    p = setup(); notes = state(who, p)
    ch = CHARS[who]
    system = SYSTEM.format(name=ch["name"], personality=ch["personality"], notes=json.dumps(notes, indent=1, ensure_ascii=False))
    convo = "".join(f"{a}: {t}\n" for a, t in history)
    user = (f"Earlier in this conversation:\n{convo}\n" if history else "") + f"The investigator says: {line}"
    args = ["claude", "--print", "--model", model, "--output-format", "json", "--system-prompt", system, "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--json-schema", json.dumps(SCHEMA)]
    try:
        r = subprocess.run(args, input=user, capture_output=True, text=True, timeout=120, cwd=tempfile.gettempdir())
        out = json.loads(r.stdout).get("structured_output") or {}
    except Exception as e:
        return {"case": cid, "group": group, "model": model, "error": str(e)[:200]}
    opened, asked = sorted(out.get("opened", [])), sorted(out.get("asked", []))
    ok = opened == sorted(want_open) and set(want_ask) <= set(asked) and bool(want_ask or not asked or group == "first-meeting")
    return {"case": cid, "group": group, "model": model, "ok": ok, "opened": opened, "asked": asked, "narration": out.get("narration", ""), "len_system": len(system)}

if __name__ == "__main__":
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    jobs = [(m, c) for m in ("haiku", "sonnet") for c in CASES for _ in range(n)]
    with cf.ThreadPoolExecutor(6) as ex:
        res = list(ex.map(lambda j: call(*j), jobs))
    json.dump(res, open("spike-results.json", "w"), indent=1, ensure_ascii=False)
    print("errors:", sum(1 for r in res if "error" in r), "of", len(res))
    for c in CASES:
        row = [c[0].ljust(13), c[1].ljust(26)]
        for m in ("haiku", "sonnet"):
            rs = [r for r in res if r["case"] == c[1] and r["model"] == m and "error" not in r]
            row.append(f"{m} {sum(r['ok'] for r in rs)}/{len(rs)}")
        print("  ".join(row))
