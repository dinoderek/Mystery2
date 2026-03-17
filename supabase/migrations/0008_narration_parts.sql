alter table game_events
add column narration_parts jsonb;

update game_events
set narration_parts = jsonb_build_array(
    jsonb_strip_nulls(
        jsonb_build_object(
            'text', narration,
            'speaker', coalesce(
                payload -> 'speaker',
                jsonb_build_object(
                    'kind', 'narrator',
                    'key', 'narrator',
                    'label', 'Narrator'
                )
            ),
            'image_id', coalesce(
                payload -> 'image_id',
                payload -> 'location_image_id',
                payload -> 'character_portrait_image_id',
                payload -> 'blueprint_image_id'
            )
        )
    )
)
where narration_parts is null;

alter table game_events
alter column narration_parts set not null;

alter table game_events
alter column narration_parts set default '[]'::jsonb;

alter table game_events
add constraint game_events_narration_parts_non_empty
check (jsonb_typeof(narration_parts) = 'array' and jsonb_array_length(narration_parts) > 0);
