import { StoryBriefSchema } from "../../../../packages/blueprint-generator/src/index.ts";

/**
 * The brief the evaluation snapshots generate from. The blueprint fixture
 * (`blueprint-v2.fixture.ts`) has no witness, so a blueprint made from this
 * brief fails the character count check; the snapshots record that verdict too.
 */
export const generatorBrief = StoryBriefSchema.parse({
  brief: "Someone took the cookies from the kitchen before snack time. The truth involves a lunch bag in the hallway.",
  targetAge: 8,
  timeBudget: 12,
  titleHint: "The Missing Cookies",
  mustInclude: ["cookies", "lunch bag"],
  culprits: 1,
  suspects: 1,
  witnesses: 1,
  locations: 2,
  redHerringTrails: 1,
  coverUps: false,
  eliminationComplexity: "simple",
});
