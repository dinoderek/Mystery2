# Labelling guide

How each kind of fault is decided, for labels and plants: what is wrong in the
narration, never what a judge should answer. On the labelling page, press each
kind (keys 1 to 5), a severity (`n` minor, `m` major) and a note (`t`); `c` if
clean. `major`: the player could act on it, or the turn fails; `minor`: it
leads nowhere.

**One owner.** A problem takes the kind that owns it: a clue given early or
changed is `clue_handling`, not `spoiler` or `fabrication`; an unsupported fact
a character states is `fabrication`, not `out_of_character`. Two problems, two
kinds.

## 1 `spoiler`

Before the accusation, the narration gives away who, why or how; tells a hidden
action as fact; does the player's reasoning or clears a suspect unearned; or
confirms a guess. A clue's content, a character's lie or theory, and accusation
turns are not.

> "The real stick is in Clementine's cape pocket."

## 2 `fabrication`

A load-bearing fact the blueprint does not hold, or that contradicts it or an
earlier turn: a person who does not exist, a place or object to search, an
event, someone placed wrongly. Could the player act on it? Atmosphere is not;
an authored lie is not, but the narrator asserting it is.

> An unauthored net-mender: "Saw young Finn rowing out at two."

## 3 `clue_handling`

Narration and recorded clues disagree: a clue told but not recorded, recorded
but not told, told with another meaning, given before its `requires` or by
someone who could not have it, or an earned clue withheld. A faithful rewording
for the child, or recalling a held clue, is not.

> "Just Barnaby and Ruby!" where the paint sheet names Clementine.

## 4 `out_of_character`

A character unlike their authored self: personality, attitude, alibi, agendas,
tells, knowledge, first-person voice, pronouns. Or the narrator breaks voice:
not "you", not warm, mechanics showing. Scary content is this kind; an earned
crack is not.

> Cheerful Finn: "Now clear off and leave me alone."

## 5 `not_age_fit`

Language too hard for `target_age`: words the child cannot work out, sentences
stacked past the age's length, misreadable idioms. Language only; a stretch
word within the allowance is not.

> For a ten-year-old: "Such information is universally disseminated."

## Planted faults

A plant makes one fault of its kind, as above, and changes nothing else. A
blueprint plant breaks what one dimension asks, as its brief in
`evaluation/dimensions/` decides, and names it as kind and judge: a clue
collapsing the shortest path, clearing evidence weakened, someone in two
places, a clue shown early, thin material, a vague gate, a payoff ending
nowhere, hard player text. Dimensions overlap, so other kinds are unknown.
