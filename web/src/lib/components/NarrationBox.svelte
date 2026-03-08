<script lang="ts">
  import { tick } from "svelte";
  import { gameSessionStore } from "$lib/domain/store.svelte";
  import TerminalMessage from "./TerminalMessage.svelte";
  import TerminalSpinner from "./TerminalSpinner.svelte";

  let sentinel: HTMLDivElement;

  $effect(() => {
    // Explicitly read history.length so Svelte 5 registers this as a dependency
    // and re-runs this effect every time a new message is pushed.
    const _len = gameSessionStore.state?.history?.length;
    const _narration = gameSessionStore.state?.narration;

    if (sentinel) {
      // After the DOM updates, smoothly scroll the sentinel into view
      tick().then(() => {
        sentinel.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
  });
</script>

<div class="flex-1 overflow-y-auto border border-t-muted/30 p-4 font-mono">
  <div class="space-y-4">
    {#if gameSessionStore.state?.narration}
      <TerminalMessage text={gameSessionStore.state.narration} type="system" />
    {/if}

    {#if gameSessionStore.state?.history && gameSessionStore.state.history.length > 0}
      {#each gameSessionStore.state.history as event}
        <TerminalMessage
          text={event.narration}
          type={event.actor === "player" ? "player" : "system"}
        />
      {/each}
    {/if}

    {#if gameSessionStore.status === "loading" && gameSessionStore.state}
      <TerminalSpinner text="Narrator is thinking..." />
    {/if}
  </div>
  <!-- Sentinel element used as scroll target -->
  <div bind:this={sentinel} aria-hidden="true"></div>
</div>
