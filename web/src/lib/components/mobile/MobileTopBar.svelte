<script lang="ts">
  let {
    title,
    turnsRemaining,
    onback,
    onmenu,
    showMenu = true,
  }: {
    title: string;
    turnsRemaining?: number;
    onback?: () => void;
    onmenu?: () => void;
    showMenu?: boolean;
  } = $props();
</script>

<header
  class="flex items-center h-12 border-b border-t-muted/30 bg-t-bg font-mono px-2 shrink-0"
>
  {#if onback}
    <button
      type="button"
      onclick={onback}
      aria-label="Back"
      data-testid="mobile-topbar-back"
      class="w-11 h-11 flex items-center justify-center text-t-primary text-lg shrink-0"
    >
      &#x2190;
    </button>
  {/if}

  <span
    class="flex-1 truncate text-t-bright text-sm font-bold min-w-0"
    data-testid="mobile-topbar-title"
  >
    {title}
  </span>

  {#if turnsRemaining !== undefined}
    <span
      class="text-t-muted/70 text-xs font-bold shrink-0 mx-1"
      data-testid="mobile-topbar-turns"
    >
      [{turnsRemaining}]
    </span>
  {/if}

  {#if showMenu && onmenu}
    <button
      type="button"
      onclick={onmenu}
      aria-label="Menu"
      data-testid="mobile-topbar-menu"
      class="w-11 h-11 flex items-center justify-center text-t-primary text-lg shrink-0"
    >
      &#x2261;
    </button>
  {/if}
</header>
