<script lang="ts">
  import { gameSessionStore } from "$lib/domain/store.svelte";
  import { accusationsLeftText } from "$lib/domain/accusations";

  // One line on a phone: tapping it wraps the line to show all of it. Wide
  // screens always show all of it.
  let expanded = $state(false);

  const currentLocationName = $derived.by(() => {
    const state = gameSessionStore.state;
    if (!state) return "UNKNOWN";
    const loc = state.locations.find((l) => l.id === state.location);
    return loc?.name || state.location;
  });

  const visibleCharacters = $derived.by(() => {
    const state = gameSessionStore.state;
    if (!state) {
      return [];
    }

    const currentLocation = state.location.trim().toLowerCase();
    return state.characters.filter(
      (character) => character.location_name.trim().toLowerCase() === currentLocation,
    );
  });

  // Who is here before the counts, which matter less when the line is cut.
  // One string, so a clipped line has no pieces running past its edge.
  const statusLine = $derived(
    [
      currentLocationName,
      visibleCharacters.map((char) => `${char.first_name} ${char.last_name}`.trim()).join(", "),
      `TIME: ${gameSessionStore.state?.time_remaining || 0}`,
      `ACCUSATIONS: ${gameSessionStore.state?.accusations_left ?? 0}`,
    ]
      .filter(Boolean)
      .join(" · "),
  );
</script>

<div class="mt-2 flex items-start gap-3 border-y border-t-muted/30 text-xs">
  <button
    class="min-h-11 shrink-0 whitespace-nowrap text-t-primary hover:text-t-bright transition-colors cursor-pointer"
    onclick={() => gameSessionStore.openNotebook()}
  >
    <span class="text-t-muted/70 font-bold">CLUES:</span>
    {gameSessionStore.state?.discovered_clues.length ?? 0}
  </button>
  <button
    type="button"
    class="min-h-11 min-w-0 flex-1 py-3 text-left leading-5 lg:cursor-default
      {expanded ? 'whitespace-normal' : 'truncate lg:whitespace-normal'}"
    aria-expanded={expanded}
    data-testid="status-line"
    title={accusationsLeftText(gameSessionStore.state?.accusations_left ?? 0)}
    onclick={() => (expanded = !expanded)}
  >
    {statusLine}
  </button>
</div>
