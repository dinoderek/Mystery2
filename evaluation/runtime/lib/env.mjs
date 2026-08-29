// Environment + URL resolution for the runtime evaluation harness.
//
// Stays Node-native (.mjs) so the harness has no TypeScript build dependency.
// What it resolves is now a single origin: the game server, which serves both
// the app and `/api`. There are no keys, because there is nothing to sign.

import { resolveWorktreePorts } from "../../../lib/worktree-ports.mjs";

/**
 * Where the game server is. `MYSTERY_API_URL` overrides the worktree's port,
 * which is what you want when pointing the harness at a server you started
 * yourself.
 */
export function resolveEnv(cwd = process.cwd()) {
  const override = process.env.MYSTERY_API_URL?.trim();
  const baseUrl = override || `http://127.0.0.1:${resolveWorktreePorts(cwd).ports.web}`;

  return {
    baseUrl,
    apiUrl: `${baseUrl}/api`,
  };
}
