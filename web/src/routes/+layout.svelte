<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { gameSessionStore } from '$lib/domain/store.svelte';

	let { children } = $props();

	onMount(() => {
		gameSessionStore.initializeTheme();
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
