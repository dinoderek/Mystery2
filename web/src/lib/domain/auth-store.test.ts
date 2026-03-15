import { beforeEach, describe, expect, it, vi } from 'vitest';

type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';
type MockSession = {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	token_type: string;
	user: {
		id: string;
		email: string;
	};
	[key: string]: unknown;
};

const {
	mockSignInWithPassword,
	mockSignOut,
	mockOnAuthStateChange,
	authState,
} = vi.hoisted(() => ({
	mockSignInWithPassword: vi.fn(),
	mockSignOut: vi.fn(),
	mockOnAuthStateChange: vi.fn(),
	authState: {
		callback: null as ((event: AuthEvent, session: MockSession | null) => void) | null,
	},
}));

vi.mock('../api/supabase', () => ({
	supabase: {
		auth: {
			signInWithPassword: mockSignInWithPassword,
			signOut: mockSignOut,
			onAuthStateChange: (callback: (event: AuthEvent, session: MockSession | null) => void) => {
				authState.callback = callback;
				mockOnAuthStateChange(callback);
				return {
					data: {
						subscription: {
							unsubscribe: vi.fn(),
						},
					},
				};
			},
		},
	},
}));

import { AuthStore } from './auth-store.svelte';

function emitAuthState(event: AuthEvent, session: MockSession | null = null) {
	if (!authState.callback) {
		throw new Error('Auth state callback not initialized');
	}
	authState.callback(event, session);
}

const makeSession = (overrides: Record<string, unknown> = {}) => ({
	access_token: 'access-token',
	refresh_token: 'refresh-token',
	expires_in: 3600,
	token_type: 'bearer',
	user: {
		id: 'user-123',
		email: 'player@test.local',
	},
	...overrides,
});

describe('AuthStore', () => {
	beforeEach(() => {
		authState.callback = null;
		mockSignInWithPassword.mockReset();
		mockSignOut.mockReset();
		mockOnAuthStateChange.mockReset();
	});

	it('starts in loading state until INITIAL_SESSION arrives', () => {
		const store = new AuthStore();
		expect(mockOnAuthStateChange).toHaveBeenCalledOnce();
		expect(store.loading).toBe(true);

		const session = makeSession();
		emitAuthState('INITIAL_SESSION', session);

		expect(store.loading).toBe(false);
		expect(store.session).toEqual(session);
		expect(store.user?.id).toBe('user-123');
	});

	it('updates session on SIGNED_IN and clears stale error', () => {
		const store = new AuthStore();
		store.error = 'Old error';

		const session = makeSession({ access_token: 'new-token' });
		emitAuthState('SIGNED_IN', session);

		expect(store.session).toEqual(session);
		expect(store.user?.email).toBe('player@test.local');
		expect(store.error).toBeNull();
	});

	it('calls signInWithPassword and returns true on success', async () => {
		mockSignInWithPassword.mockResolvedValue({ error: null });
		const store = new AuthStore();

		const success = await store.signIn('player@test.local', 'test-password-123');

		expect(success).toBe(true);
		expect(mockSignInWithPassword).toHaveBeenCalledWith({
			email: 'player@test.local',
			password: 'test-password-123',
		});
		expect(store.error).toBeNull();
	});

	it('propagates invalid credentials from signIn', async () => {
		mockSignInWithPassword.mockResolvedValue({
			error: { message: 'Invalid login credentials' },
		});
		const store = new AuthStore();

		const success = await store.signIn('player@test.local', 'wrong-password');

		expect(success).toBe(false);
		expect(store.error).toBe('Invalid login credentials');
	});

	it('keeps session alive on TOKEN_REFRESHED and handles null refresh session', () => {
		const store = new AuthStore();
		const initialSession = makeSession();
		emitAuthState('INITIAL_SESSION', initialSession);

		const refreshed = makeSession({ access_token: 'refreshed-token' });
		emitAuthState('TOKEN_REFRESHED', refreshed);
		expect(store.session?.access_token).toBe('refreshed-token');
		expect(store.error).toBeNull();

		emitAuthState('TOKEN_REFRESHED', null);
		expect(store.session).toBeNull();
		expect(store.error).toBe('Session expired, please sign in again');
	});

	it('treats non-manual SIGNED_OUT as session expiry', () => {
		const store = new AuthStore();
		emitAuthState('INITIAL_SESSION', makeSession());

		emitAuthState('SIGNED_OUT', null);
		expect(store.session).toBeNull();
		expect(store.user).toBeNull();
		expect(store.error).toBe('Session expired, please sign in again');
	});

	it('does not show expiry error for manual signOut', async () => {
		mockSignOut.mockResolvedValue({ error: null });
		const store = new AuthStore();
		emitAuthState('INITIAL_SESSION', makeSession());

		await store.signOut();
		emitAuthState('SIGNED_OUT', null);

		expect(mockSignOut).toHaveBeenCalledOnce();
		expect(store.error).toBeNull();
	});
});
