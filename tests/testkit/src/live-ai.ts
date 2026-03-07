export function isLiveAIEnabled(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  const raw = env.AI_LIVE ?? "";
  return raw === "1" || raw.toLowerCase() === "true";
}

export function resolveLiveAILabel(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  const label = env.AI_LIVE_LABEL?.trim();
  if (label) return label;

  const model = env.AI_MODEL?.trim();
  if (model) return model;

  return "custom";
}

export function getLiveSuiteTitle(base: string): string {
  const label = resolveLiveAILabel();
  return `${base} [ai=${label}]`;
}
