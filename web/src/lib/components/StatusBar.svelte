<script lang="ts">
  import { gameSessionStore } from "$lib/domain/store.svelte";

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
</script>

<div
  class="flex justify-between items-center border border-green-500/30 p-2 bg-green-500/5 mt-4 text-sm"
>
  <span>LOCATION: {gameSessionStore.state?.location || "UNKNOWN"}</span>
  <span class="text-green-500/50">type 'help' to see commands</span>
  <span>TIME: {gameSessionStore.state?.time_remaining || 0}</span>
</div>
<div
  class="border border-green-500/30 p-2 bg-green-500/5 mt-2 text-sm flex gap-2"
>
  <span class="text-green-500/70">VISIBLE:</span>
  <div>
    {#if visibleCharacters.length > 0}
      {#each visibleCharacters as char, i}
        <span
          >{char.first_name} {char.last_name}{i < visibleCharacters.length - 1 ? ", " : ""}</span
        >
      {/each}
    {:else}
      <span class="text-green-500/50">None</span>
    {/if}
  </div>
</div>
