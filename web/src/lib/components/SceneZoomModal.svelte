<script lang="ts">
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import SignedImage from './SignedImage.svelte';
  import TerminalMessage from './TerminalMessage.svelte';

  function close() {
    gameSessionStore.showZoomModal = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    }
  }

  const sceneEntries = $derived(gameSessionStore.getActiveSceneText());
  const image = $derived(gameSessionStore.activeStoryImage);
</script>

<svelte:window onkeydown={handleKeydown} />

{#if gameSessionStore.showZoomModal && image && gameSessionStore.blueprint_id}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex flex-col bg-t-bg/95"
    onclick={close}
  >
    <div class="flex min-h-0 flex-1 items-center justify-center p-4">
      <SignedImage
        blueprintId={gameSessionStore.blueprint_id}
        imageId={image.image_id}
        alt={image.title}
        class="max-h-full max-w-full object-contain"
      />
    </div>

    {#if sceneEntries.length > 0}
      <div class="shrink-0 border-t border-t-muted/30 bg-t-bg/80 px-6 py-4 overflow-y-auto max-h-[35vh]">
        <header class="mb-2 text-[11px] uppercase tracking-wide text-t-muted/80">
          {image.title}
        </header>
        <div class="space-y-2 font-mono">
          {#each sceneEntries as entry}
            <TerminalMessage text={entry.text} speaker={entry.speaker} theme={gameSessionStore.theme} />
          {/each}
        </div>
      </div>
    {/if}

    <div class="shrink-0 border-t border-t-muted/20 px-6 py-2 text-center text-xs text-t-muted/60">
      Press <span class="text-t-bright">Escape</span> or click anywhere to close
    </div>
  </div>
{/if}
