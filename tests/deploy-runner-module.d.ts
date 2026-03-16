declare module "../../../scripts/deploy-runner.mjs" {
  export interface RunnerStep {
    id: string;
    title: string;
    command: string[];
  }

  export interface RunnerPlan {
    metadata: {
      parallelEnabled: boolean;
    };
    serialPreDeploy: RunnerStep[];
    parallelDeployLanes: Record<string, RunnerStep[]>;
    serialPostDeploy: RunnerStep[];
  }

  export function runLoggedStep(
    title: string,
    action: () => Promise<void>,
    options?: {
      logger?: Pick<Console, "log" | "error">;
      prefix?: string;
    },
  ): Promise<void>;

  export function runDeployPlan(
    plan: RunnerPlan,
    options: {
      executeStep: (
        step: RunnerStep,
        context: {
          phase: string;
          laneName: string | null;
          signal: AbortSignal | null;
        },
      ) => Promise<void>;
    },
  ): Promise<void>;
}
