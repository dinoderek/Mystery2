export interface AIProvider {
  generateNarration(prompt: string): Promise<string>;
  evaluateReasoning(
    context: any,
  ): Promise<{
    resolved: boolean;
    outcome?: "win" | "loss";
    narration: string;
  }>;
}

export class MockAIProvider implements AIProvider {
  async generateNarration(prompt: string): Promise<string> {
    return `[Mock] Narration for: ${prompt.substring(0, 50)}...`;
  }

  async evaluateReasoning(
    context: any,
  ): Promise<{
    resolved: boolean;
    outcome?: "win" | "loss";
    narration: string;
  }> {
    // For T036 and US6 deterministic test:
    // First call returns unresolved (outcome: null)
    // Second call (length > 0) returns resolved win
    const history = context.history || [];
    if (history.length === 0) {
      return {
        resolved: false,
        narration: "[Mock] Interesting theory. Do you have more evidence?",
      };
    }

    return {
      resolved: true,
      outcome: "win",
      narration: "[Mock] You are absolutely right. The culprit is cornered!",
    };
  }
}

export function getAIProvider(): AIProvider {
  return new MockAIProvider();
}
