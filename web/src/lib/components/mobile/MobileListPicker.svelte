<script lang="ts">
  import { slide } from 'svelte/transition';

  let {
    title,
    items,
    onselect,
    oncancel,
  }: {
    title: string;
    items: { id: string; label: string; subtitle?: string }[];
    onselect: (item: { id: string; label: string; subtitle?: string }) => void;
    oncancel: () => void;
  } = $props();

  function handleBackdropClick() {
    oncancel();
  }

  function handleSelect(item: { id: string; label: string; subtitle?: string }) {
    onselect(item);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-40 bg-t-bg/60"
  data-testid="mobile-list-picker-backdrop"
  onclick={handleBackdropClick}
  onkeydown={(e) => { if (e.key === 'Escape') oncancel(); }}
>
  <!-- Panel sliding up from bottom -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="absolute bottom-0 left-0 right-0 z-50 bg-t-bg border-t border-t-muted/30 font-mono max-h-[70vh] flex flex-col"
    data-testid="mobile-list-picker-panel"
    transition:slide={{ duration: 200 }}
    onclick={(e) => e.stopPropagation()}
  >
    <!-- Title -->
    <div class="px-4 py-3 border-b border-t-muted/30 shrink-0">
      <span class="text-t-bright text-sm font-bold">{title}</span>
    </div>

    <!-- Scrollable list -->
    <div class="overflow-y-auto flex-1">
      {#each items as item (item.id)}
        <button
          type="button"
          data-testid="mobile-list-picker-row"
          class="w-full flex items-center justify-between px-4 min-h-[48px] text-left border-b border-t-muted/10 active:bg-t-muted/10"
          onclick={() => handleSelect(item)}
        >
          <div class="flex flex-col py-2">
            <span class="text-t-bright text-sm">{item.label}</span>
            {#if item.subtitle}
              <span class="text-t-muted/60 text-xs">{item.subtitle}</span>
            {/if}
          </div>
          <span class="text-t-muted/40 text-sm shrink-0 ml-2">&#x203A;</span>
        </button>
      {/each}
    </div>

    <!-- Cancel button -->
    <div class="px-4 py-3 border-t border-t-muted/30 shrink-0">
      <button
        type="button"
        data-testid="mobile-list-picker-cancel"
        class="w-full h-11 text-t-muted text-sm font-bold active:bg-t-muted/10"
        onclick={oncancel}
      >
        Cancel
      </button>
    </div>
  </div>
</div>
