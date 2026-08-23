<script lang="ts">
  import { onMount } from 'svelte';
  import { imageLinkCache, type ImageLinkEntry } from '$lib/api/image-link-cache';

  let {
    blueprintId,
    imageId,
    alt = '',
    class: className = '',
    loadingText = 'Loading image...',
    placeholderText = 'Image unavailable',
    onload = undefined,
    onfail = undefined,
  } = $props<{
    blueprintId: string;
    imageId: string;
    alt?: string;
    class?: string;
    loadingText?: string;
    placeholderText?: string;
    onload?: () => void;
    onfail?: () => void;
  }>();

  let entry = $state<ImageLinkEntry>({ url: null, expiresAt: null, loading: true, placeholder: false });
  // A signed URL can be issued for an asset that is not actually in storage, so
  // a working link is not proof of a working image. Without this, callers get a
  // broken <img> instead of the placeholder they asked for.
  let brokenUrl = $state<string | null>(null);

  onMount(() => {
    const unsubscribe = imageLinkCache.subscribe(blueprintId, imageId, (updated) => {
      entry = updated;
      if (updated.placeholder && onfail) {
        onfail();
      }
    });
    return unsubscribe;
  });

  function handleImageError() {
    brokenUrl = entry.url;
    onfail?.();
  }
</script>

{#if entry.loading}
  <div class="story-image-placeholder flex items-center justify-center text-sm text-t-muted/70 animate-pulse {className}">
    {loadingText}
  </div>
{:else if entry.url && !entry.placeholder && entry.url !== brokenUrl}
  <img
    src={entry.url}
    {alt}
    class="story-image-asset block {className}"
    loading="lazy"
    onload={onload}
    onerror={handleImageError}
  />
{:else}
  <div class="story-image-placeholder flex items-center justify-center text-sm text-t-muted/80 {className}">
    {placeholderText}
  </div>
{/if}
