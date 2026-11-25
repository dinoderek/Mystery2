<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { isNearEnd } from '$lib/domain/viewport';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import TerminalMessage from './TerminalMessage.svelte';
  import TerminalSpinner from './TerminalSpinner.svelte';

  let scrollContainer = $state<HTMLDivElement | null>(null);

  // Whether the player rests at the end, kept as they scroll: a resize cannot
  // tell whether they were reading it.
  let atEnd = true;
  // The height `atEnd` was judged at. A scroll event under a new height, such
  // as a smooth scroll still moving as the keyboard opens, is not the player.
  let judgedAtHeight = 0;

  const page = $derived(gameSessionStore.activePage);

  const lines = $derived.by(() =>
    (page?.events ?? []).flatMap((event) => event.narration_parts),
  );

  /**
   * A live page grows at the bottom as the story advances, so follow it there.
   * Turning back to an older page should instead start at its beginning.
   */
  $effect(() => {
    const container = scrollContainer;
    const atBottom = gameSessionStore.isOnLivePage;
    // Re-run whenever either the page or its length changes.
    const _index = page?.index;
    const _count = lines.length;

    if (!container) return;
    tick().then(() => {
      container.scrollTo({
        top: atBottom ? container.scrollHeight : 0,
        behavior: 'smooth',
      });
    });
  });

  // The on-screen keyboard shrinks this area; a live page keeps its last line in view.
  onMount(() => {
    if (!scrollContainer) return;
    const resize = new ResizeObserver(() => {
      if (!scrollContainer) return;
      if (atEnd && gameSessionStore.isOnLivePage) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
      judgedAtHeight = scrollContainer.clientHeight;
    });
    judgedAtHeight = scrollContainer.clientHeight;
    resize.observe(scrollContainer);
    return () => resize.disconnect();
  });
</script>

<div
  bind:this={scrollContainer}
  onscroll={() => {
    if (scrollContainer && scrollContainer.clientHeight === judgedAtHeight) {
      atEnd = isNearEnd(scrollContainer);
    }
  }}
  class="min-h-0 flex-1 overflow-y-auto border border-t-muted/30 p-4 font-mono"
  data-testid="page-narration"
>
  <div class="space-y-4">
    {#each lines as line}
      <TerminalMessage text={line.text} speaker={line.speaker} />
    {/each}

    {#if gameSessionStore.status === 'loading' && gameSessionStore.isOnLivePage}
      <TerminalSpinner text="Narrator is thinking..." />
    {/if}
  </div>
</div>
