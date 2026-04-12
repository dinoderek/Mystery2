<script lang="ts">
  import { slide } from 'svelte/transition';
  import { gameSessionStore } from '$lib/domain/store.svelte';
  import { themeStore } from '$lib/domain/theme-store.svelte';
  import { mobilePrefs, type TextSize } from '$lib/domain/mobile-prefs.svelte';

  let {
    open = $bindable(false),
  }: {
    open: boolean;
  } = $props();

  const currentLocationName = $derived.by(() => {
    const state = gameSessionStore.state;
    if (!state) return 'UNKNOWN';
    const loc = state.locations.find((l) => l.id === state.location);
    return loc?.name || state.location;
  });

  const visibleCharacters = $derived.by(() => {
    const state = gameSessionStore.state;
    if (!state) return [];
    const currentLocation = state.location.trim().toLowerCase();
    return state.characters.filter(
      (c) => c.location_name.trim().toLowerCase() === currentLocation,
    );
  });

  const themes = $derived(themeStore.getThemeList());
  const activeThemeId = $derived(themeStore.activeId);

  function closeDrawer() {
    open = false;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      closeDrawer();
    }
  }

  function handleHelp() {
    gameSessionStore.showHelp = true;
    closeDrawer();
  }

  function handleZoom() {
    gameSessionStore.showZoomModal = true;
    closeDrawer();
  }

  function handleThemeChange(id: string) {
    themeStore.setTheme(id);
    const themeId = themeStore.getActiveTheme().id;
    gameSessionStore.setTheme(themeId === 'amber' ? 'amber' : 'matrix', false);
  }

  function handleTextSize(size: TextSize) {
    mobilePrefs.setTextSize(size);
  }

  function handleQuit() {
    gameSessionStore.submitInput('quit');
    closeDrawer();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-t-bg/60 z-40"
    onclick={handleBackdropClick}
    data-testid="mobile-drawer-backdrop"
  ></div>

  <div
    class="fixed left-0 right-0 top-12 z-50 bg-t-bg border-b border-t-muted/30 font-mono overflow-y-auto max-h-[calc(100vh-3rem)]"
    transition:slide={{ duration: 200 }}
    data-testid="mobile-drawer"
  >
    <!-- Close button -->
    <div class="flex justify-end px-3 pt-2">
      <button
        type="button"
        onclick={closeDrawer}
        aria-label="Close drawer"
        data-testid="mobile-drawer-close"
        class="w-11 h-11 flex items-center justify-center text-t-muted text-lg"
      >
        &#x2715;
      </button>
    </div>

    <!-- Status section -->
    <section class="px-4 pb-4 border-b border-t-muted/20">
      <h3 class="text-t-muted/70 text-xs font-bold uppercase tracking-wider mb-2">Status</h3>
      <div class="space-y-1 text-sm">
        <div>
          <span class="text-t-muted/70">Location:</span>
          <span class="text-t-bright" data-testid="drawer-location">{currentLocationName}</span>
        </div>
        <div>
          <span class="text-t-muted/70">Time:</span>
          <span class="text-t-bright" data-testid="drawer-time">{gameSessionStore.state?.time_remaining ?? 0}</span>
        </div>
        <div>
          <span class="text-t-muted/70">Characters:</span>
          {#if visibleCharacters.length > 0}
            <span class="text-t-bright" data-testid="drawer-characters">
              {visibleCharacters.map((c) => `${c.first_name} ${c.last_name}`).join(', ')}
            </span>
          {:else}
            <span class="text-t-muted/50">None</span>
          {/if}
        </div>
      </div>
    </section>

    <!-- Actions section -->
    <section class="px-4 py-4 border-b border-t-muted/20">
      <h3 class="text-t-muted/70 text-xs font-bold uppercase tracking-wider mb-2">Actions</h3>
      <div class="flex gap-2">
        <button
          type="button"
          onclick={handleHelp}
          data-testid="drawer-help"
          class="px-3 h-10 rounded border border-t-muted/40 text-t-bright text-xs font-bold active:bg-t-muted/10"
        >
          Help
        </button>
        {#if gameSessionStore.activeStoryImage}
          <button
            type="button"
            onclick={handleZoom}
            data-testid="drawer-zoom"
            class="px-3 h-10 rounded border border-t-muted/40 text-t-bright text-xs font-bold active:bg-t-muted/10"
          >
            Zoom
          </button>
        {/if}
      </div>
    </section>

    <!-- Appearance section -->
    <section class="px-4 py-4 border-b border-t-muted/20">
      <h3 class="text-t-muted/70 text-xs font-bold uppercase tracking-wider mb-2">Appearance</h3>

      <!-- Theme picker -->
      <div class="mb-3">
        <span class="text-t-muted/70 text-xs">Theme</span>
        <div class="flex flex-wrap gap-2 mt-1">
          {#each themes as theme}
            <button
              type="button"
              onclick={() => handleThemeChange(theme.id)}
              data-testid="drawer-theme-{theme.id}"
              class="px-3 h-9 rounded text-xs font-bold border transition-colors
                {activeThemeId === theme.id
                  ? 'border-t-primary text-t-primary'
                  : 'border-t-muted/30 text-t-muted active:bg-t-muted/10'}"
            >
              {theme.name}
            </button>
          {/each}
        </div>
      </div>

      <!-- Text size picker -->
      <div>
        <span class="text-t-muted/70 text-xs">Text Size</span>
        <div class="flex gap-2 mt-1">
          {#each [{ value: 'sm', label: 'Small' }, { value: 'base', label: 'Medium' }, { value: 'lg', label: 'Large' }] as option}
            <button
              type="button"
              onclick={() => handleTextSize(option.value as TextSize)}
              data-testid="drawer-textsize-{option.value}"
              class="px-3 h-9 rounded text-xs font-bold border transition-colors
                {mobilePrefs.textSize === option.value
                  ? 'border-t-primary text-t-primary'
                  : 'border-t-muted/30 text-t-muted active:bg-t-muted/10'}"
            >
              {option.label}
            </button>
          {/each}
        </div>
      </div>
    </section>

    <!-- Quit section -->
    <section class="px-4 py-4">
      <button
        type="button"
        onclick={handleQuit}
        data-testid="drawer-quit"
        class="w-full h-11 rounded border border-t-error/50 text-t-error text-xs font-bold active:bg-t-error/10"
      >
        End Session
      </button>
    </section>
  </div>
{/if}
