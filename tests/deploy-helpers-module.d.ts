declare module "../../../scripts/deploy-helpers.mjs" {
  export const DEPLOY_ENVIRONMENTS: string[];

  export function parseDeployArgs(argv: string[]): {
    env: string;
    preflight: boolean;
    dryRun: boolean;
    skipUsers: boolean;
    skipSeed: boolean;
  };

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
  }): string;

  export function buildCommandPlan(options: {
    envName: string;
    target: Record<string, string>;
    functionNames: string[];
    includePreflight: boolean;
    includeSeed: boolean;
    includeUsers: boolean;
    hasDbPassword: boolean;
  }): Array<{ id: string; title: string; command: string[] }>;

  export function discoverEdgeFunctions(functionsDir: string): Promise<string[]>;

  export function loadBootstrapUsers(usersPath: string): Promise<
    Array<{ email: string; password: string; email_confirm?: boolean }>
  >;
}
