<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { themeStore } from '$lib/domain/theme-store.svelte';
	import { gameSessionStore } from '$lib/domain/store.svelte';
	import { playerStore } from '$lib/domain/player-store.svelte';
	import TerminalSpinner from '$lib/components/TerminalSpinner.svelte';

	let { children } = $props();

	onMount(() => {
		themeStore.init();
		gameSessionStore.initializeTheme();
		playerStore.init();
	});

	// There is no auth bypass any more: picking a profile is one request with
	// no password, so the tests just pick one like a player would.
	$effect(() => {
		if (playerStore.loading) return;

		const currentPath = $page.url.pathname;
		const currentTarget = `${$page.url.pathname}${$page.url.search}${$page.url.hash}`;
		const isLoginPage = currentPath === '/login';

		if (!playerStore.player && !isLoginPage) {
			// Save intended path so the picker can send them back to it
			if (!playerStore.intendedPath) {
				playerStore.intendedPath = currentTarget;
			}
			goto('/login', { replaceState: true });
		} else if (playerStore.player && isLoginPage) {
			const target = playerStore.intendedPath || '/';
			playerStore.intendedPath = null;
			goto(target, { replaceState: true });
		}
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if playerStore.loading}
	<main class="min-h-screen bg-t-bg text-t-primary font-mono flex items-center justify-center">
		<TerminalSpinner text="Loading profiles..." />
	</main>
{:else}
	{@render children()}
{/if}
