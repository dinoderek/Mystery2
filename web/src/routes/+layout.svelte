<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { themeStore } from '$lib/domain/theme-store.svelte';
	import { gameSessionStore } from '$lib/domain/store.svelte';

	let { children } = $props();

	onMount(() => {
		themeStore.init();
		gameSessionStore.initializeTheme();
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
