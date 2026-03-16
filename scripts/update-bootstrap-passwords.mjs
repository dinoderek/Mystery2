/* global console, process */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  DEPLOY_ENVIRONMENTS,
  getBootstrapUsersPath,
  loadBootstrapUsers,
  loadEnvFileVars,
} from "./deploy-helpers.mjs";

export const PASSWORD_UPDATE_ENVIRONMENTS = DEPLOY_ENVIRONMENTS.filter(
  (envName) => envName !== "prod",
);

export function parseUpdateBootstrapPasswordsArgs(argv) {
  const options = {
    env: null,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (token === "--env") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --env (expected dev|staging)");
      }
      options.env = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--env=")) {
      options.env = token.slice("--env=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.env) {
    throw new Error("Missing required --env <dev|staging> option");
  }

  if (!PASSWORD_UPDATE_ENVIRONMENTS.includes(options.env)) {
    throw new Error(
      `Invalid --env value "${options.env}" (expected dev|staging)`,
    );
  }

  return options;
}

export function planBootstrapPasswordUpdates(configUsers, authUsersByEmail) {
  const seenEmails = new Set();
  const updates = [];
  const missingEmails = [];

  for (const user of configUsers) {
    const normalizedEmail = user.email.trim().toLowerCase();
    if (seenEmails.has(normalizedEmail)) {
      throw new Error(
        `Duplicate bootstrap user email in config: ${normalizedEmail}`,
      );
    }
    seenEmails.add(normalizedEmail);

    const authUser = authUsersByEmail.get(normalizedEmail);
    if (!authUser?.id) {
      missingEmails.push(normalizedEmail);
      continue;
    }

    const attributes = { password: user.password };
    if (user.email_confirm !== undefined) {
      attributes.email_confirm = user.email_confirm;
    }

    updates.push({
      id: authUser.id,
      email: normalizedEmail,
      attributes,
    });
  }

  return { updates, missingEmails };
}

async function listAuthUsersByEmail(adminClient) {
  const usersByEmail = new Map();
  const perPage = 200;

  for (let page = 1; page < 200; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(`Failed to list auth users: ${error.message}`);
    }

    const users = data?.users ?? [];
    for (const user of users) {
      if (!user.email) continue;
      usersByEmail.set(user.email.toLowerCase(), user);
    }

    if (users.length < perPage) break;
  }

  return usersByEmail;
}

function printUsage() {
  console.log(
    "Usage: npm run users:update-passwords -- --env <dev|staging> [--dry-run]",
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }

  const rootDir = process.cwd();
  const options = parseUpdateBootstrapPasswordsArgs(argv);
  const envPath = path.join(rootDir, `.env.deploy.${options.env}.local`);
  const envVarsFromFile = await loadEnvFileVars(envPath, true);
  const runtimeEnv = {
    ...envVarsFromFile,
    ...process.env,
  };

  const supabaseUrl = runtimeEnv.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = runtimeEnv.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      `Missing required deploy environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY`,
    );
  }

  const usersPath = getBootstrapUsersPath(rootDir, options.env);
  const configUsers = await loadBootstrapUsers(usersPath);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authUsersByEmail = await listAuthUsersByEmail(admin);
  const { updates, missingEmails } = planBootstrapPasswordUpdates(
    configUsers,
    authUsersByEmail,
  );

  if (missingEmails.length > 0) {
    throw new Error(
      `Cannot update passwords because these users do not exist yet: ${missingEmails.join(", ")}`,
    );
  }

  console.log(
    `Prepared ${updates.length} password update(s) from ${path.relative(rootDir, usersPath)}`,
  );

  if (options.dryRun) {
    for (const update of updates) {
      console.log(`- would update ${update.email}`);
    }
    console.log("Dry run complete. No passwords were changed.");
    return;
  }

  for (const update of updates) {
    const { error } = await admin.auth.admin.updateUserById(
      update.id,
      update.attributes,
    );

    if (error) {
      throw new Error(`Failed to update ${update.email}: ${error.message}`);
    }

    console.log(`- updated ${update.email}`);
  }

  console.log(`Updated ${updates.length} bootstrap user password(s).`);
}

const entrypointPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : null;
const currentPath = fileURLToPath(import.meta.url);

if (entrypointPath && currentPath === entrypointPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
