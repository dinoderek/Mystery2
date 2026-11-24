import path from 'node:path';
import process from 'node:process';
import adapter from '@sveltejs/adapter-node';

// A test server builds into a folder of its own (`MYSTERY_WEB_BUILD_DIR`), so
// two processes building from one checkout never write the same files. Unset,
// the build goes where SvelteKit puts it: `.svelte-kit/` and `build/`.
const buildDir = process.env.MYSTERY_WEB_BUILD_DIR;

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// The game is one Node process on the machine: the same server that
		// serves the SPA also serves `/api`, which is why nothing here needs
		// CORS, JWTs or signed URLs any more.
		adapter: adapter(buildDir ? { out: path.join(buildDir, 'build') } : {}),
		...(buildDir ? { outDir: path.join(buildDir, '.svelte-kit') } : {})
	}
};

export default config;
