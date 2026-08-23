<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { prefersReducedMotion } from 'svelte/motion';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import {
    NOTEBOOK_SECTIONS,
    buildPeopleView,
    buildPlacesView,
    groupCluesByOrigin,
    nextSection,
    sectionAtIndex,
    type NotebookSection,
  } from '$lib/domain/notebook';

  // Tab is a toggle players hammer, so the whole animation stays under ~150ms.
  const FADE_MS = 90;
  const FLY_MS = 140;
  const SCROLL_STEP = 80;

  const fadeMs = $derived(prefersReducedMotion.current ? 0 : FADE_MS);
  const flyMs = $derived(prefersReducedMotion.current ? 0 : FLY_MS);

  const gameState = $derived(gameSessionStore.state);
  const active = $derived(gameSessionStore.notebookSection);
  const places = $derived(buildPlacesView(gameState));
  const people = $derived(buildPeopleView(gameState));
  const clues = $derived(gameState?.discovered_clues ?? []);
  const clueBuckets = $derived(groupCluesByOrigin(clues));

  let bodyEl = $state<HTMLElement | null>(null);

  $effect(() => {
    // Re-runs on section change so a new section always starts at the top.
    active;
    if (bodyEl) {
      bodyEl.scrollTop = 0;
    }
  });

  function close() {
    gameSessionStore.closeNotebook();
  }

  function select(section: NotebookSection) {
    gameSessionStore.notebookSection = section;
  }

  function scrollBy(amount: number) {
    bodyEl?.scrollBy({ top: amount, behavior: prefersReducedMotion.current ? 'auto' : 'smooth' });
  }

  /**
   * Every notebook key lives here. If the session page also handled Tab, the
   * outcome would depend on listener registration order — close, then reopen.
   * One owner makes the toggle deterministic.
   */
  function handleKeydown(e: KeyboardEvent) {
    if (!gameSessionStore.showNotebook) {
      // Held Tab would otherwise flicker the panel open and shut.
      if (e.key === 'Tab' && !e.repeat && gameSessionStore.state) {
        e.preventDefault();
        gameSessionStore.openNotebook();
      }
      return;
    }

    if (e.key === 'Tab' || e.key === 'Escape') {
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      close();
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      select(nextSection(active, 1));
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      select(nextSection(active, -1));
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      scrollBy(SCROLL_STEP);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      scrollBy(-SCROLL_STEP);
      return;
    }

    if (/^[1-9]$/.test(e.key)) {
      const target = sectionAtIndex(Number(e.key));
      e.preventDefault();
      if (target) {
        select(target);
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if gameSessionStore.showNotebook && gameState}
  <div
    class="fixed inset-0 z-50 bg-t-bg font-mono text-t-muted/90"
    role="dialog"
    aria-modal="true"
    aria-labelledby="notebook-title"
    transition:fade={{ duration: fadeMs }}
  >
    <div
      class="h-full max-w-6xl mx-auto flex flex-col p-4 sm:p-6"
      transition:fly={{ y: 8, duration: flyMs, easing: cubicOut }}
    >
      <header class="shrink-0 border-b border-t-muted/30 pb-2">
        <div class="flex items-baseline justify-between gap-4">
          <h2 id="notebook-title" class="text-xl font-bold text-t-primary">CASE NOTEBOOK</h2>
          <p class="text-xs text-t-muted/50 hidden sm:block">
            ←/→ sections · ↑/↓ scroll · 1-4 jump · Tab close
          </p>
        </div>

        <div class="flex gap-4 mt-3 text-sm" role="tablist" aria-label="Notebook sections">
          {#each NOTEBOOK_SECTIONS as section (section.id)}
            <button
              type="button"
              role="tab"
              id="nb-tab-{section.id}"
              aria-controls="nb-panel"
              aria-selected={section.id === active}
              tabindex={section.id === active ? 0 : -1}
              class="pb-1 -mb-[1px] border-b-2 transition-colors cursor-pointer {section.id ===
              active
                ? 'text-t-bright border-t-primary font-bold'
                : 'text-t-muted/60 border-transparent hover:text-t-primary'}"
              onclick={() => select(section.id)}
            >
              {section.label}
            </button>
          {/each}
        </div>
      </header>

      <div
        bind:this={bodyEl}
        id="nb-panel"
        role="tabpanel"
        aria-labelledby="nb-tab-{active}"
        tabindex="0"
        class="flex-1 overflow-y-auto py-5 text-sm"
      >
        <div class="max-w-3xl">
          {#if active === 'story'}
            {#if gameState.premise}
              <p class="mb-2">{gameState.premise}</p>
            {/if}
            {#if gameState.mystery_summary}
              <p class="text-t-bright">{gameState.mystery_summary}</p>
            {/if}
            {#if !gameState.premise && !gameState.mystery_summary}
              <p class="italic text-t-muted/60">No case briefing available.</p>
            {/if}
          {:else if active === 'places'}
            {#if places.length > 0}
              <ul class="space-y-4">
                {#each places as place (place.id)}
                  <li>
                    <span class="text-t-bright">{place.name}</span>
                    {#if place.isCurrent}
                      <span class="text-t-primary"> [ you are here ]</span>
                    {/if}
                    {#if place.summary}
                      <span class="text-t-muted/80"> — {place.summary}</span>
                    {/if}
                    <div class="text-t-muted/60 text-xs mt-1">
                      {#if place.people.length > 0}
                        With: {place.people.join(', ')}
                      {:else}
                        No one here right now
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="italic text-t-muted/60">No places recorded yet.</p>
            {/if}
          {:else if active === 'people'}
            {#if people.length > 0}
              <ul class="space-y-4">
                {#each people as person (person.id)}
                  <li>
                    <span class="text-t-bright">{person.displayName}</span>
                    {#if person.summary}
                      <span class="text-t-muted/80"> — {person.summary}</span>
                    {/if}
                    <div class="text-t-muted/60 text-xs mt-1">
                      {#if person.isHere}
                        Here with you
                      {:else if person.locationLabel}
                        At the {person.locationLabel}
                      {:else}
                        Whereabouts unknown
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="italic text-t-muted/60">No people recorded yet.</p>
            {/if}
          {:else if clues.length > 0}
            <div class="space-y-5">
              {#each clueBuckets as bucket (bucket.bucket)}
                <div>
                  <h3 class="text-t-primary font-bold text-xs uppercase mb-2">{bucket.label}</h3>
                  <div class="space-y-3">
                    {#each bucket.groups as group (group.key)}
                      <div>
                        <h4 class="text-t-muted/70 font-bold text-xs mb-1">
                          {group.label} ({group.count})
                        </h4>
                        <ul class="list-disc list-inside pl-1 space-y-1">
                          {#each group.clues as clue (clue.id)}
                            <li class="text-t-muted/90">
                              {clue.text}{#if clue.off_script}<span class="text-t-muted/60"
                                  >&nbsp;(a lucky break!)</span
                                >{/if}
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="italic text-t-muted/60">
              No clues discovered yet. Search locations and talk to people to find them.
            </p>
          {/if}
        </div>
      </div>

      <button
        class="shrink-0 w-full border border-t-muted/50 hover:bg-t-muted/10 text-t-primary py-2 transition-colors cursor-pointer"
        onclick={close}
      >
        [ CLOSE ]
      </button>
    </div>
  </div>
{/if}
