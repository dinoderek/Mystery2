-- Record the AI model that produced each event's narration.
-- Nullable: pre-existing rows and non-AI events have no associated model.
-- For OpenRouter this is the model the API reported serving the request (which
-- can differ from the requested profile model under routing/fallback); for the
-- mock provider it is the configured profile model.
alter table game_events
add column model text;
