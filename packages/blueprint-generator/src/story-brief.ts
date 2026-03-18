import { z } from "zod";

export const StoryBriefSchema = z.object({
  brief: z.string().trim().min(1),
  targetAge: z.number().int().positive(),
  timeBudget: z.number().int().positive().optional(),
  titleHint: z.string().trim().min(1).optional(),
  oneLinerHint: z.string().trim().min(1).optional(),
  artStyle: z.string().trim().min(1).optional(),
  mustInclude: z.array(z.string().trim().min(1)).optional(),
});

export type StoryBrief = z.infer<typeof StoryBriefSchema>;
