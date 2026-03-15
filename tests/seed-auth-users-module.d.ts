declare module "../../../scripts/seed-auth-users.mjs" {
  export function generateAuthSeedPassword(): string;
  export function formatGeneratedAuthUsersNotice(
    rootDir: string,
    localPath: string,
    users: Array<{ email: string; password: string; email_confirm?: boolean }>,
  ): string;
  export function ensureLocalAuthUsersFile(options?: {
    localPath?: string;
    examplePath?: string;
  }): Promise<{
    created: boolean;
    localPath: string;
    users: Array<{ email: string; password: string; email_confirm?: boolean }>;
  }>;
}
