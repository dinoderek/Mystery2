export const LIVE_AI_PROFILES = ["default", "cost_control"] as const;
export type LiveAIProfile = (typeof LIVE_AI_PROFILES)[number];

export function isLiveAIEnabled(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  const raw = env.AI_LIVE ?? "";
  return raw === "1" || raw.toLowerCase() === "true";
}

export function resolveLiveAIProfile(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): LiveAIProfile {
  return env.AI_PROFILE === "cost_control" ? "cost_control" : "default";
}

export function getLiveSuiteTitle(base: string): string {
  const profile = resolveLiveAIProfile();
  return `${base} [profile=${profile}]`;
}
