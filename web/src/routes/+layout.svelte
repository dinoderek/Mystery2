<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { themeStore } from '$lib/domain/theme-store.svelte';
	import { gameSessionStore } from '$lib/domain/store.svelte';
	import { authStore } from '$lib/domain/auth-store.svelte';
	import { mobileDetect } from '$lib/domain/mobile-detect.svelte';
	import { mobilePrefs } from '$lib/domain/mobile-prefs.svelte';
	import TerminalSpinner from '$lib/components/TerminalSpinner.svelte';
	import MobileKeyboardProxy from '$lib/components/MobileKeyboardProxy.svelte';

	let { children } = $props();

	onMount(() => {
		themeStore.init();
		gameSessionStore.initializeTheme();
		mobileDetect.init();
		mobilePrefs.init();
	});

	function isE2EAuthBypassEnabled(): boolean {
		if (!import.meta.env.VITE_E2E_AUTH_BYPASS) return false;
		if (typeof window === 'undefined') return false;
		return window.localStorage.getItem('mystery-e2e-auth-bypass') === '1';
	}

	// Reactive auth gate
	$effect(() => {
		if (isE2EAuthBypassEnabled()) return;
		if (authStore.loading) return;

		const currentPath = $page.url.pathname;
		const currentTarget = `${$page.url.pathname}${$page.url.search}${$page.url.hash}`;
		const isLoginPage = currentPath === '/login';

		if (!authStore.session && !isLoginPage) {
			// Save intended path for post-login redirect
			if (!authStore.intendedPath) {
				authStore.intendedPath = currentTarget;
			}
			goto('/login', { replaceState: true });
		} else if (authStore.session && isLoginPage) {
			// Redirect authenticated users away from login
			const target = authStore.intendedPath || '/';
			authStore.intendedPath = null;
			goto(target, { replaceState: true });
		}
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if authStore.loading}
	<main class="min-h-screen bg-t-bg text-t-primary font-mono flex items-center justify-center">
		<TerminalSpinner text="Initializing secure session..." />
	</main>
{:else}
	{@render children()}
	<MobileKeyboardProxy />
{/if}
