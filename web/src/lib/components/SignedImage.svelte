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
  } = $props<{
    blueprintId: string;
    imageId: string;
    alt?: string;
    class?: string;
    loadingText?: string;
    placeholderText?: string;
  }>();

  let entry = $state<ImageLinkEntry>({ url: null, expiresAt: null, loading: true, placeholder: false });

  onMount(() => {
    const unsubscribe = imageLinkCache.subscribe(blueprintId, imageId, (updated) => {
      entry = updated;
    });
    return unsubscribe;
  });
</script>

{#if entry.loading}
  <div class="story-image-placeholder flex items-center justify-center text-sm text-t-muted/70 animate-pulse {className}">
    {loadingText}
  </div>
{:else if entry.url && !entry.placeholder}
  <img
    src={entry.url}
    {alt}
    class="story-image-asset block w-full object-cover {className}"
    loading="lazy"
  />
{:else}
  <div class="story-image-placeholder flex items-center justify-center text-sm text-t-muted/80 {className}">
    {placeholderText}
  </div>
{/if}
