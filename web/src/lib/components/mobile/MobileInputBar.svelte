<script lang="ts">
  import { onMount } from 'svelte';
  import { MobileInputBarState } from '$lib/domain/mobile-input-bar.svelte';

  let {
    onsend,
    oncancel,
    disabled,
    placeholder,
    prefill,
  }: {
    onsend: (text: string) => void;
    oncancel: () => void;
    disabled: boolean;
    placeholder: string;
    prefill?: string;
  } = $props();

  const bar = new MobileInputBarState();

  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    bar.disabled = disabled;
  });

  onMount(() => {
    bar.init(prefill);
    inputEl?.focus();
  });
</script>

<div
  class="flex items-center gap-1 px-2 py-1 border-t border-t-muted/30 bg-t-bg font-mono shrink-0"
  data-testid="mobile-input-bar"
>
  <button
    type="button"
    onclick={oncancel}
    aria-label="Cancel"
    data-testid="mobile-input-bar-cancel"
    class="w-12 h-12 flex items-center justify-center text-t-muted text-lg shrink-0"
  >
    &#x2715;
  </button>

  <input
    bind:this={inputEl}
    bind:value={bar.value}
    onkeydown={(e) => bar.handleKeydown(e, onsend)}
    {placeholder}
    disabled={disabled}
    data-testid="mobile-input-bar-input"
    class="flex-1 min-w-0 bg-transparent text-t-bright placeholder-t-muted/50 font-mono outline-none"
    style="font-size: 16px;"
  />

  <button
    type="button"
    onclick={() => bar.send(onsend)}
    disabled={!bar.canSend}
    aria-label="Send"
    data-testid="mobile-input-bar-send"
    class="w-12 h-12 flex items-center justify-center border border-t-primary text-t-primary text-lg shrink-0 disabled:opacity-50"
  >
    &#x27A4;
  </button>
</div>
