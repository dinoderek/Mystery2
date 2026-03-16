declare module "../../../scripts/deploy-helpers.mjs" {
  export const DEPLOY_ENVIRONMENTS: string[];
  export const DEFAULT_FUNCTION_DEPLOY_JOBS: number;

  export interface CommandStep {
    id: string;
    title: string;
    command: string[];
    runtimeCommand?: string[];
  }

  export interface CommandPlan {
    metadata: {
      parallelEnabled: boolean;
      functionCount: number;
      functionJobs: number;
    };
    serialPreDeploy: CommandStep[];
    parallelDeployLanes: {
      pages: CommandStep[];
      supabase: CommandStep[];
    };
    serialPostDeploy: CommandStep[];
  }

  export function parseDeployArgs(argv: string[]): {
    env: string;
    preflight: boolean;
    dryRun: boolean;
    skipUsers: boolean;
    skipSeed: boolean;
    imageDir: string | null;
    allowMissingImages: boolean;
    serial: boolean;
    functionJobs: number | null;
  };
  export function parseFunctionJobs(value: string): number;
  export function resolveFunctionDeployJobs(options: {
    functionCount: number;
    requestedJobs?: number | null;
    serial?: boolean;
  }): number;

  export function validateTargetsShape(targets: unknown): void;
  export function assertRequiredDeployEnvVars(env: Record<string, string>): void;
  export function shouldBootstrapUsers(envName: string, skipUsers: boolean): boolean;
  export function shouldSeedBlueprints(skipSeed: boolean): boolean;
  export function getBootstrapUsersPath(rootDir: string, envName: string): string;
  export function getBootstrapUsersExamplePath(rootDir: string, envName: string): string;
  export function isPlaceholderPassword(password: string): boolean;
  export function formatPlanLine(step: {
    id: string;
    command: string[];
    runtimeCommand?: string[];
  }): string;

  export function buildCommandPlan(options: {
    envName: string;
    target: Record<string, string>;
    functionNames: string[];
    includePreflight: boolean;
    includeSeed: boolean;
    includeUsers: boolean;
    hasDbPassword: boolean;
    imageDir?: string | null;
    allowMissingImages?: boolean;
    serial?: boolean;
    functionJobs?: number | null;
  }): CommandPlan;

  export function discoverEdgeFunctions(functionsDir: string): Promise<string[]>;

  export function loadBootstrapUsers(usersPath: string): Promise<
    Array<{ email: string; password: string; email_confirm?: boolean }>
  >;
}
