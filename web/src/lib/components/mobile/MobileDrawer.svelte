<script lang="ts">
  import { slide } from 'svelte/transition';
  import { MobileDrawerState } from '$lib/domain/mobile-drawer.svelte';

  let {
    open = $bindable(false),
  }: {
    open: boolean;
  } = $props();

  const drawer = new MobileDrawerState();

  function close() {
    open = false;
  }

  function handleHelp() {
    drawer.openHelp();
    close();
  }

  function handleZoom() {
    drawer.openZoom();
    close();
  }

  function handleTheme(id: string) {
    drawer.changeTheme(id);
  }

  function handleTextSize(size: 'sm' | 'base' | 'lg') {
    drawer.changeTextSize(size);
  }

  function handleQuit() {
    drawer.quit();
    close();
  }
</script>

{#if open}
  <!-- Backdrop -->
  <button
    type="button"
    class="fixed inset-0 z-40 bg-t-bg/60"
    aria-label="Close drawer"
    data-testid="mobile-drawer-backdrop"
    onclick={close}
  ></button>

  <!-- Panel -->
  <div
    class="fixed left-0 right-0 top-12 z-50 bg-t-bg border-b border-t-muted/30 font-mono overflow-y-auto max-h-[calc(100vh-3rem)]"
    data-testid="mobile-drawer-panel"
    transition:slide={{ duration: 200 }}
  >
    <!-- Close button -->
    <div class="flex justify-end px-3 pt-2">
      <button
        type="button"
        onclick={close}
        aria-label="Close drawer"
        data-testid="mobile-drawer-close"
        class="w-11 h-11 flex items-center justify-center text-t-muted text-lg"
      >
        &#x2715;
      </button>
    </div>

    <!-- Status section -->
    <section class="px-4 pb-3 border-b border-t-muted/20" data-testid="mobile-drawer-status">
      <h3 class="text-t-primary text-xs font-bold mb-2 uppercase">Status</h3>
      <div class="space-y-1 text-sm">
        <div>
          <span class="text-t-muted/70 font-bold">LOCATION:</span>
          <span class="text-t-bright" data-testid="mobile-drawer-location">{drawer.currentLocationName}</span>
        </div>
        <div>
          <span class="text-t-muted/70 font-bold">TIME:</span>
          <span class="text-t-bright" data-testid="mobile-drawer-time">{drawer.timeRemaining}</span>
        </div>
        <div>
          <span class="text-t-muted/70 font-bold">CHARACTERS:</span>
          {#if drawer.visibleCharacters.length > 0}
            <span class="text-t-bright" data-testid="mobile-drawer-characters">
              {drawer.visibleCharacters.map((c) => `${c.first_name} ${c.last_name}`).join(', ')}
            </span>
          {:else}
            <span class="text-t-muted/50" data-testid="mobile-drawer-characters">None</span>
          {/if}
        </div>
      </div>
    </section>

    <!-- Actions section -->
    <section class="px-4 py-3 border-b border-t-muted/20" data-testid="mobile-drawer-actions">
      <h3 class="text-t-primary text-xs font-bold mb-2 uppercase">Actions</h3>
      <div class="flex flex-col gap-2">
        <button
          type="button"
          onclick={handleHelp}
          data-testid="mobile-drawer-help"
          class="text-left text-sm text-t-bright py-2 px-3 border border-t-muted/30 active:bg-t-primary/10"
        >
          Help
        </button>
        {#if drawer.hasActiveImage}
          <button
            type="button"
            onclick={handleZoom}
            data-testid="mobile-drawer-zoom"
            class="text-left text-sm text-t-bright py-2 px-3 border border-t-muted/30 active:bg-t-primary/10"
          >
            Zoom Image
          </button>
        {/if}
      </div>
    </section>

    <!-- Appearance section -->
    <section class="px-4 py-3 border-b border-t-muted/20" data-testid="mobile-drawer-appearance">
      <h3 class="text-t-primary text-xs font-bold mb-2 uppercase">Appearance</h3>

      <!-- Theme picker -->
      <div class="mb-3">
        <span class="text-t-muted/70 text-xs font-bold block mb-1">THEME</span>
        <div class="flex flex-col gap-1">
          {#each drawer.themes as theme (theme.id)}
            <button
              type="button"
              onclick={() => handleTheme(theme.id)}
              data-testid="mobile-drawer-theme-{theme.id}"
              class="flex items-center gap-2 text-sm py-2 px-3 text-left {drawer.activeThemeId === theme.id ? 'text-t-primary border border-t-primary/50' : 'text-t-bright border border-transparent'} active:bg-t-primary/10"
            >
              <span class="w-4 h-4 rounded-full border border-t-muted/30 flex items-center justify-center shrink-0">
                {#if drawer.activeThemeId === theme.id}
                  <span class="w-2 h-2 rounded-full bg-t-primary"></span>
                {/if}
              </span>
              {theme.name}
            </button>
          {/each}
        </div>
      </div>

      <!-- Text size -->
      <div>
        <span class="text-t-muted/70 text-xs font-bold block mb-1">TEXT SIZE</span>
        <div class="flex flex-col gap-1">
          {#each [{ id: 'sm', label: 'Small' }, { id: 'base', label: 'Medium' }, { id: 'lg', label: 'Large' }] as option (option.id)}
            <button
              type="button"
              onclick={() => handleTextSize(option.id as 'sm' | 'base' | 'lg')}
              data-testid="mobile-drawer-textsize-{option.id}"
              class="flex items-center gap-2 text-sm py-2 px-3 text-left {drawer.textSize === option.id ? 'text-t-primary border border-t-primary/50' : 'text-t-bright border border-transparent'} active:bg-t-primary/10"
            >
              <span class="w-4 h-4 rounded-full border border-t-muted/30 flex items-center justify-center shrink-0">
                {#if drawer.textSize === option.id}
                  <span class="w-2 h-2 rounded-full bg-t-primary"></span>
                {/if}
              </span>
              {option.label}
            </button>
          {/each}
        </div>
      </div>
    </section>

    <!-- Quit section -->
    <section class="px-4 py-3" data-testid="mobile-drawer-quit">
      <button
        type="button"
        onclick={handleQuit}
        data-testid="mobile-drawer-end-session"
        class="w-full text-sm text-t-error py-2 px-3 border border-t-error/30 active:bg-t-error/10 font-bold"
      >
        End Session
      </button>
    </section>
  </div>
{/if}
