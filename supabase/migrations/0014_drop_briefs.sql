-- Remove the briefs feature (the "draft/brief creator").
-- The per-user brief management UI and its edge functions were removed; nothing
-- in the runtime consumes this table. The blueprint generator's StoryBrief type
-- is a separate concept and is unaffected.

drop table if exists briefs;
