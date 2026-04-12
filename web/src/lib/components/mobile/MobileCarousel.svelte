<script lang="ts" generics="T">
	import { onMount, type Snippet } from 'svelte';
	import TerminalSpinner from '$lib/components/TerminalSpinner.svelte';

	let {
		items,
		activeIndex = $bindable(0),
		children,
		onselect,
		emptyMessage = 'No items',
		loading = false,
	}: {
		items: T[];
		activeIndex?: number;
		children: Snippet<[T, number]>;
		onselect?: (item: T, index: number) => void;
		emptyMessage?: string;
		loading?: boolean;
	} = $props();

	let scrollContainer: HTMLDivElement | undefined = $state();
	let scrollDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	function updateActiveFromScroll() {
		if (!scrollContainer) return;
		const containerWidth = scrollContainer.clientWidth;
		const scrollLeft = scrollContainer.scrollLeft;
		const centerX = scrollLeft + containerWidth / 2;

		let closest = 0;
		let closestDist = Infinity;

		for (let i = 0; i < scrollContainer.children.length; i++) {
			const child = scrollContainer.children[i] as HTMLElement;
			if (!child.dataset.carouselItem) continue;
			const childCenter = child.offsetLeft + child.offsetWidth / 2;
			const dist = Math.abs(childCenter - centerX);
			if (dist < closestDist) {
				closestDist = dist;
				closest = Number(child.dataset.carouselItem);
			}
		}

		activeIndex = closest;
	}

	function handleScrollEnd() {
		updateActiveFromScroll();
	}

	function handleScroll() {
		// Fallback debounce for browsers without scrollend (older Safari)
		clearTimeout(scrollDebounceTimer);
		scrollDebounceTimer = setTimeout(() => {
			updateActiveFromScroll();
		}, 300);
	}

	function scrollToIndex(index: number) {
		if (!scrollContainer) return;
		const children = scrollContainer.querySelectorAll('[data-carousel-item]');
		const target = children[index] as HTMLElement | undefined;
		target?.scrollIntoView({ behavior: 'smooth', inline: 'center' });
	}

	function handleCardTap(item: T, index: number) {
		onselect?.(item, index);
	}

	onMount(() => {
		return () => {
			clearTimeout(scrollDebounceTimer);
		};
	});
</script>

{#if loading}
	<div class="flex-1 flex items-center justify-center">
		<TerminalSpinner />
	</div>
{:else if items.length === 0}
	<div class="flex-1 flex items-center justify-center text-t-muted font-mono text-sm">
		{emptyMessage}
	</div>
{:else}
	<div class="flex flex-col items-center gap-4 flex-1">
		<!-- Scroll container -->
		<div
			bind:this={scrollContainer}
			class="flex gap-4 px-[10vw] overflow-x-auto snap-x snap-mandatory scrollbar-none w-full"
			style="-webkit-overflow-scrolling: touch;"
			onscrollend={handleScrollEnd}
			onscroll={handleScroll}
		>
			{#each items as item, i (i)}
				<button
					type="button"
					data-carousel-item={i}
					class="snap-center shrink-0 w-[80vw] max-w-[320px] cursor-pointer text-left"
					onclick={() => handleCardTap(item, i)}
				>
					{@render children(item, i)}
				</button>
			{/each}
		</div>

		<!-- Dot indicators -->
		{#if items.length > 1}
			<div class="flex gap-2 justify-center py-2">
				{#each items as _, i (i)}
					<button
						type="button"
						class="w-2 h-2 rounded-full transition-colors {i === activeIndex
							? 'bg-t-primary'
							: 'bg-t-muted/30'}"
						aria-label="Go to item {i + 1}"
						onclick={() => scrollToIndex(i)}
					></button>
				{/each}
			</div>
		{/if}
	</div>
{/if}
