<script lang="ts">
  let {
    title,
    imageUrl = null,
    loading = false,
    placeholder = false,
    placeholderText = 'Image unavailable',
    compact = false,
  } = $props<{
    title: string;
    imageUrl?: string | null;
    loading?: boolean;
    placeholder?: boolean;
    placeholderText?: string;
    compact?: boolean;
  }>();

  const showImage = $derived(Boolean(imageUrl) && !placeholder && !loading);
</script>

<section
  class={`story-image-panel border border-t-muted/30 bg-t-bg/60 ${
    compact ? 'p-2' : 'p-3'
  }`}
  data-testid="story-image-panel"
>
  <header class="mb-2 text-[11px] uppercase tracking-wide text-t-muted/80">
    {title}
  </header>

  {#if loading}
    <div class="story-image-placeholder flex items-center justify-center border border-dashed border-t-muted/40 text-t-muted/70">
      Loading image...
    </div>
  {:else if showImage}
    <img
      src={imageUrl ?? undefined}
      alt={title}
      class="story-image-asset block w-full border border-t-muted/30 object-cover"
      loading="lazy"
    />
  {:else}
    <div class="story-image-placeholder flex items-center justify-center border border-dashed border-t-muted/40 text-center text-sm text-t-muted/80">
      {placeholderText}
    </div>
  {/if}
</section>
