import { supabase } from '../api/supabase';
import type { Session, User } from '@supabase/supabase-js';

export class AuthStore {
	session = $state<Session | null>(null);
	user = $state<User | null>(null);
	loading = $state(true);
	error = $state<string | null>(null);
	private manualSignOut = false;

	/** Path the user was trying to reach before being redirected to login */
	intendedPath = $state<string | null>(null);

	constructor() {
		supabase.auth.onAuthStateChange((event, session) => {
			const hadSession = this.session !== null;

			this.session = session;
			this.user = session?.user ?? null;

			if (event === 'INITIAL_SESSION') {
				this.loading = false;
			}

			if (event === 'SIGNED_IN') {
				this.manualSignOut = false;
				this.error = null;
			}

			if (event === 'SIGNED_OUT') {
				this.session = null;
				this.user = null;
				if (hadSession && !this.manualSignOut) {
					this.error = 'Session expired, please sign in again';
				}
				this.manualSignOut = false;
			}

			if (event === 'TOKEN_REFRESHED') {
				this.session = session;
				this.user = session?.user ?? null;
				if (!session) {
					this.error = 'Session expired, please sign in again';
				} else {
					this.error = null;
				}
			}
		});
	}

	async signIn(email: string, password: string): Promise<boolean> {
		this.error = null;

		const { error } = await supabase.auth.signInWithPassword({ email, password });

		if (error) {
			this.error = error.message;
			return false;
		}

		return true;
	}

	async signOut(): Promise<void> {
		this.error = null;
		this.manualSignOut = true;
		const { error } = await supabase.auth.signOut();
		if (error) {
			this.manualSignOut = false;
			this.error = error.message;
		}
	}
}

export const authStore = new AuthStore();
