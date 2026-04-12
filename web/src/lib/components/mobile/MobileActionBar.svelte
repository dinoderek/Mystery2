<script lang="ts">
  import { MobileActionBarState } from '$lib/domain/mobile-action-bar.svelte';
  import MobileListPicker from './MobileListPicker.svelte';

  let {
    onreply,
    oninputprefill,
  }: {
    onreply: () => void;
    oninputprefill: (text: string) => void;
  } = $props();

  const bar = new MobileActionBarState();
</script>

<div class="font-mono px-3 py-2" data-testid="mobile-action-bar">
  <div class="flex gap-2 overflow-x-auto scrollbar-none">
    {#if bar.mode === 'explore'}
      <button
        type="button"
        disabled={bar.isLoading}
        data-testid="action-move"
        class="shrink-0 px-3 h-10 rounded-full border border-t-muted/40 text-t-bright text-xs font-bold
          disabled:opacity-50 active:bg-t-muted/10"
        onclick={() => bar.openLocationPicker()}
      >
        Move
      </button>
      <button
        type="button"
        disabled={bar.isLoading || bar.talkDisabled}
        data-testid="action-talk"
        class="shrink-0 px-3 h-10 rounded-full border border-t-muted/40 text-t-bright text-xs font-bold
          disabled:opacity-50 active:bg-t-muted/10"
        onclick={() => bar.openCharacterPicker()}
      >
        Talk
      </button>
      <button
        type="button"
        disabled={bar.isLoading}
        data-testid="action-search"
        class="shrink-0 px-3 h-10 rounded-full border border-t-muted/40 text-t-bright text-xs font-bold
          disabled:opacity-50 active:bg-t-muted/10"
        onclick={() => bar.submitSearch()}
      >
        Search
      </button>
      <button
        type="button"
        disabled={bar.isLoading}
        data-testid="action-accuse"
        class="shrink-0 px-3 h-10 rounded-full border border-t-muted/40 text-t-bright text-xs font-bold
          disabled:opacity-50 active:bg-t-muted/10"
        onclick={() => oninputprefill('accuse ')}
      >
        Accuse
      </button>
      <button
        type="button"
        disabled={bar.isLoading}
        data-testid="action-reply"
        class="shrink-0 px-3 h-10 rounded-full border border-t-primary text-t-primary text-xs font-bold
          disabled:opacity-50 active:bg-t-muted/10"
        onclick={onreply}
      >
        Reply
      </button>
    {:else if bar.mode === 'talk'}
      <button
        type="button"
        disabled={bar.isLoading}
        data-testid="action-end-convo"
        class="shrink-0 px-3 h-10 rounded-full border border-t-muted/40 text-t-bright text-xs font-bold
          disabled:opacity-50 active:bg-t-muted/10"
        onclick={() => bar.submitEndConvo()}
      >
        End convo
      </button>
      <button
        type="button"
        disabled={bar.isLoading}
        data-testid="action-reply"
        class="shrink-0 px-3 h-10 rounded-full border border-t-primary text-t-primary text-xs font-bold
          disabled:opacity-50 active:bg-t-muted/10"
        onclick={onreply}
      >
        Reply
      </button>
    {:else if bar.mode === 'accuse'}
      <button
        type="button"
        disabled={bar.isLoading}
        data-testid="action-reply"
        class="shrink-0 px-3 h-10 rounded-full border border-t-primary text-t-primary text-xs font-bold
          disabled:opacity-50 active:bg-t-muted/10"
        onclick={onreply}
      >
        State your reasoning
      </button>
    {/if}
  </div>
</div>

{#if bar.activePicker === 'locations'}
  <MobileListPicker
    title="Move to..."
    items={bar.locationItems}
    onselect={(item) => bar.selectLocation(item)}
    oncancel={() => bar.closePicker()}
  />
{/if}

{#if bar.activePicker === 'characters'}
  <MobileListPicker
    title="Talk to..."
    items={bar.characterItems}
    onselect={(item) => bar.selectCharacter(item)}
    oncancel={() => bar.closePicker()}
  />
{/if}
