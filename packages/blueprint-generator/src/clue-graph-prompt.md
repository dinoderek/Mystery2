# Writing a clue-graph mystery

You write one mystery case for a children's detective game. A child plays it
by talking to the narrator: they walk between places, search them, question
the people there, and in the end name who did it and say why. The game is for
a child to feel what a detective feels: noticing something odd, catching a
person out, and working out the answer from what they found themselves. A
good case is fair, so the answer is there to be found; it rewards thinking,
so guessing is not enough; and it is kind, so nobody is hurt and the wrong
done is the size of a child's world.

You write facts, not prose. The narrator turns every fact into the words the
child reads, at the child's age, so your job is the story's logic: what is
true, who knows it, who hides it, and what the child must do to learn it.

## The model

A case is a graph. Everything the child can learn is a clue, and what holds a
clue back is a gate. `docs/clue-graph.md` explains the model and
`schema/clue-graph-schema.ts` is the exact shape; read both before you start.
In short:

- The **opening** is what everyone knows at the start.
- **Evidence** is found by searching a place or a spot in it. It is always
  true.
- A **statement** is what a character says. It is true, or false with a
  reason (`why`). The child is never told which.
- A **tell** is what a character does that shows there is more to learn, such
  as a glance or a fidget.
- A **conclusion** is a rule over clues and other conclusions: all of these,
  or any of these. A conclusion clears a suspect, names the culprit or
  explains a red herring. The child never sees one; the game checks the
  child's notebook against them when they accuse.

A character gives some statements on first meeting, others when asked about
something once a prompt is held, and others only through a gate: after their
earlier clues are out, when the child shows them the right clue, or when the
child presses a line of questioning that a tell hints at. A gated statement
can take back an earlier false one. That is how a lie is caught: the child
finds what contradicts it, shows it, and the person admits the truth.

Each fact states what it establishes plainly and completely, with every name,
time, place and object it depends on. Names of people, places and spots stay
as you write them. A character's `personality` and `demeanor` lines are
direction for the narrator, not lines for the child.

## The order of work

Build the case in this order. It is the order that worked when the example
cases were written by hand, and each step needs the one before it.

1. **The truth.** Decide what happened, minute by minute, and why the culprit
   did it. Write `truth.timeline` and `truth.motive`. Everything later must
   agree with this timeline: a true statement or a piece of evidence never
   disagrees with it, and a false statement always does.
2. **Suspects and conclusions.** Decide who could have done it and why each
   innocent suspect looks guilty. Write the conclusions: for each innocent
   suspect, a clearing that lasts (one that no later clue takes back), and
   for the culprit, more than one route the child could take, at least one of
   them without the culprit's confession. Add a conclusion for each red
   herring that explains it away.
3. **The evidence those rules need.** For every clue a rule names, decide what
   it is and where it comes from: a finding in a place, a statement or a tell.
   Put findings in places the child will search, and in hidden spots revealed
   by another clue when a step should come later.
4. **First words.** For each character, write what they say on first
   meeting, true or false. These set up the case: who was where, who saw what,
   and the lies the child will need to catch.
5. **Every lie.** For each false statement, write why the character says it,
   which of their later statements takes it back, and what the child must do
   to get there: which clue to show, or which line to press and the tell that
   hints at it. A lie should fall to something the child can find.
6. **Prompts.** For every statement a character gives when asked, write what
   it is about and which clues prompt the question, so the child has a reason
   to ask.
7. **Check, then finish the people.** Run the validator and fix everything it
   names. Then write each character's `knows` (plain true facts they share
   when asked, never a clue and never a hint at one), their `appearance` (a
   few facts about how they look), and one demeanor line for each stance they
   can take.

Size the case to the brief: its `size` sets how many places, people and clues
the case has and how long the shortest route is. `schema/clue-graph-sizes.ts`
holds the numbers.

## How to check your work

- **The validator** is the case's check, exactly as the harness runs it:
  `node scripts/validate-case.ts ./case.json`. It names every fault by its
  field. Fix the fault in the story, not just the field: a route that is too
  short wants another step, not a renamed clue.
- **The trails.** Once the case passes, run
  `node scripts/print-clue-graph-trails.mjs ./case.json`. It prints every
  route to every conclusion, step by step. Read each route as the child
  would, holding only what they hold at that step. Would they think to search
  there, ask that, or show that? If not, add the prompt, the tell or the
  pointer that would lead them.
- **The timeline.** Read every true fact against `truth.timeline` and every
  false one against it too. Check that each place, time and object agrees
  everywhere it appears, and that no `knows` fact, appearance or opening fact
  gives away a clue that should be earned.
- **The people.** Each character's lies, tells and demeanor should fit who
  they are and what they did. An innocent suspect has a reason to look guilty
  and a reason to hide it; the culprit has a reason to lie.

## A worked example

`examples/dragon-crown.json` is a hand-written case: a crown goes missing
before a school play, the girl everyone suspects was practising her speech in
secret, and the boy who squashed the crown by accident blames her. Read it
with its trails (`node scripts/print-clue-graph-trails.mjs
examples/dragon-crown.json`) to see each step of the order of work above: the
timeline, the clearing that survives when the first alibi falls, two routes
to the culprit beside his confession, and lies taken back by gated
statements. `examples/greenhouse-prizewinner.json` is a larger one. Learn the
shape from them; do not copy their stories.
