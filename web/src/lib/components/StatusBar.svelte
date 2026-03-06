<script lang="ts">
  import { gameSessionStore } from "$lib/domain/store.svelte";
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
    {#if gameSessionStore.state?.characters && gameSessionStore.state.characters.length > 0}
      {#each gameSessionStore.state.characters as char, i}
        <span
          >{char.first_name}
          {char.last_name}{i < gameSessionStore.state.characters.length - 1
            ? ", "
            : ""}</span
        >
      {/each}
    {:else}
      <span class="text-green-500/50">None</span>
    {/if}
  </div>
</div>
