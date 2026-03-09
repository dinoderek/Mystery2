import { spawnSync } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  assertRequiredDeployEnvVars,
  buildCommandPlan,
  buildFunctionSecretPairs,
  DEPLOY_ENVIRONMENTS,
  discoverEdgeFunctions,
  formatPlanLine,
  getBootstrapUsersPath,
  loadBootstrapUsers,
  loadEnvFileVars,
  loadTargets,
  parseDeployArgs,
  shouldBootstrapUsers,
  shouldSeedBlueprints,
} from "./deploy-helpers.mjs";
import { npxBin } from "./supabase-utils.mjs";

const DUPLICATE_USER_ERROR =
  /already (?:registered|exists)|has already been registered|duplicate key|user already exists/i;

function runCommand(command, options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    capture = false,
  } = options;

  const [binary, ...args] = command;
  const result = spawnSync(binary, args, {
    cwd,
    env,
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf-8",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    const detail = capture
      ? (result.stderr || result.stdout || "").trim()
      : "See command output above.";
    throw new Error(
      `Command failed (${result.status ?? 1}): ${command.join(" ")}\n${detail}`,
    );
  }

  return capture ? (result.stdout || "") : "";
}

async function runStep(title, action) {
  console.log(`\n[STEP] ${title}`);
  try {
    await action();
    console.log(`[OK] ${title}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[FAIL] ${title}`);
    console.error(message);
    throw error;
  }
}

async function validatePagesProject(target, deployEnv, rootDir) {
  const output = runCommand(
    [npxBin, "wrangler", "pages", "project", "list", "--json"],
    { cwd: rootDir, env: deployEnv, capture: true },
  );

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Unable to parse Cloudflare Pages project list JSON output");
  }

  const projects = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.projects)
      ? parsed.projects
      : [];

  const found = projects.some(
    (project) => project && project.name === target.pagesProjectName,
  );

  if (!found) {
    throw new Error(
      `Cloudflare Pages project \"${target.pagesProjectName}\" not found for target environment`,
    );
  }
}

async function validateSupabaseProject(target, deployEnv, rootDir) {
  const output = runCommand(
    [npxBin, "supabase", "projects", "list", "--output", "json"],
    { cwd: rootDir, env: deployEnv, capture: true },
  );

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Unable to parse Supabase projects list JSON output");
  }

  const projects = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.projects)
      ? parsed.projects
      : [];

  const found = projects.some((project) => {
    const candidates = [
      project?.id,
      project?.ref,
      project?.project_ref,
      project?.reference,
    ];
    return candidates.some((value) => value === target.supabaseProjectRef);
  });

  if (!found) {
    throw new Error(
      `Supabase project ref \"${target.supabaseProjectRef}\" was not found for the current access token`,
    );
  }
}

function createSupabaseClients(supabaseUrl, serviceRoleKey, anonKey) {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { admin, anon };
}

async function seedAuthUsers({ supabaseUrl, serviceRoleKey, users }) {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let createdCount = 0;
  let existingCount = 0;

  for (const user of users) {
    const { error } = await admin.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: user.email_confirm ?? true,
    });

    if (!error) {
      createdCount += 1;
      continue;
    }

    if (DUPLICATE_USER_ERROR.test(error.message)) {
      existingCount += 1;
      continue;
    }

    throw new Error(`Failed to bootstrap user ${user.email}: ${error.message}`);
  }

  console.log(
    `Ensured ${users.length} user(s): created=${createdCount}, existing=${existingCount}`,
  );
}

async function listAllUserEmails(adminClient) {
  const emails = new Set();
  const perPage = 200;

  for (let page = 1; page < 200; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(`Failed to list users for smoke check: ${error.message}`);
    }

    const users = data?.users ?? [];
    for (const user of users) {
      if (user.email) emails.add(user.email.toLowerCase());
    }

    if (users.length < perPage) break;
  }

  return emails;
}

async function assertFrontendReachable(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `Frontend URL health check failed (${response.status}) at ${url}`,
    );
  }
}

async function assertBlueprintStorageSeeded(adminClient) {
  const { data, error } = await adminClient.storage
    .from("blueprints")
    .list("", { limit: 100 });

  if (error) {
    throw new Error(`Unable to list blueprints bucket contents: ${error.message}`);
  }

  const jsonCount = (data ?? []).filter((item) => item.name.endsWith(".json")).length;
  if (jsonCount === 0) {
    throw new Error("Blueprint storage bucket is empty (expected seeded blueprint JSON files)");
  }

  console.log(`Blueprint storage contains ${jsonCount} JSON file(s)`);
}

async function assertBlueprintsListFunctionWorks({
  envName,
  supabaseUrl,
  anonClient,
  adminClient,
  anonKey,
}) {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const email = `deploy-smoke-${envName}-${timestamp}-${randomSuffix}@test.local`;
  const password = `Smoke-${randomSuffix}-Pass123!`;

  let smokeUserId = null;

  try {
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      throw new Error(`Failed to create smoke-check auth user: ${error.message}`);
    }

    smokeUserId = data?.user?.id ?? null;

    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData.session?.access_token) {
      throw new Error(
        `Failed to sign in smoke-check auth user: ${signInError?.message ?? "unknown error"}`,
      );
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/blueprints-list`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${signInData.session.access_token}`,
        apikey: anonKey,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `blueprints-list smoke check failed (${response.status}): ${body.slice(0, 200)}`,
      );
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.blueprints)) {
      throw new Error("blueprints-list returned an invalid payload shape");
    }

    if (payload.blueprints.length === 0) {
      throw new Error("blueprints-list returned zero blueprints (expected seeded data)");
    }

    console.log(`blueprints-list returned ${payload.blueprints.length} blueprint(s)`);
  } finally {
    if (smokeUserId) {
      const { error } = await adminClient.auth.admin.deleteUser(smokeUserId);
      if (error) {
        console.warn(`Warning: could not remove smoke-check user ${email}: ${error.message}`);
      }
    }
  }
}

async function assertBootstrapUsersExist(adminClient, users) {
  const expected = new Set(users.map((user) => user.email.toLowerCase()));
  const actualEmails = await listAllUserEmails(adminClient);
  const missing = [...expected].filter((email) => !actualEmails.has(email));

  if (missing.length > 0) {
    throw new Error(`Missing expected bootstrap users: ${missing.join(", ")}`);
  }

  console.log(`Verified ${expected.size} bootstrap user(s)`);
}

async function runSmokeChecks({
  envName,
  target,
  deployEnv,
  bootstrapUsers,
  verifyBootstrapUsers,
}) {
  const { admin, anon } = createSupabaseClients(
    target.expectedSupabaseUrl,
    deployEnv.SUPABASE_SERVICE_ROLE_KEY,
    deployEnv.VITE_SUPABASE_ANON_KEY,
  );

  await runStep("Smoke: frontend URL reachable", async () => {
    await assertFrontendReachable(target.expectedFrontendUrl);
  });

  await runStep("Smoke: blueprints bucket seeded", async () => {
    await assertBlueprintStorageSeeded(admin);
  });

  await runStep("Smoke: blueprints-list returns data", async () => {
    await assertBlueprintsListFunctionWorks({
      envName,
      supabaseUrl: target.expectedSupabaseUrl,
      anonClient: anon,
      adminClient: admin,
      anonKey: deployEnv.VITE_SUPABASE_ANON_KEY,
    });
  });

  if (verifyBootstrapUsers && bootstrapUsers.length > 0) {
    await runStep("Smoke: bootstrap users exist", async () => {
      await assertBootstrapUsersExist(admin, bootstrapUsers);
    });
  }
}

function ensureTargetMatchesEnvContract(target, deployEnv) {
  if (target.expectedSupabaseUrl !== deployEnv.VITE_SUPABASE_URL) {
    throw new Error(
      `Target mismatch: expectedSupabaseUrl (${target.expectedSupabaseUrl}) must match VITE_SUPABASE_URL (${deployEnv.VITE_SUPABASE_URL})`,
    );
  }
}

function printUsage() {
  console.log("Usage: npm run deploy -- --env <dev|staging|prod> [--preflight] [--dry-run] [--skip-users] [--skip-seed]");
}

async function main() {
  const rootDir = process.cwd();
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }

  const options = parseDeployArgs(argv);
  const targetsPath = path.join(rootDir, "deploy", "targets.json");
  const targets = await loadTargets(targetsPath);
  const target = targets[options.env];

  const envPath = path.join(rootDir, `.env.deploy.${options.env}.local`);
  const envVarsFromFile = await loadEnvFileVars(envPath, true);
  const deployEnv = {
    ...envVarsFromFile,
    ...process.env,
  };

  assertRequiredDeployEnvVars(deployEnv);
  ensureTargetMatchesEnvContract(target, deployEnv);

  const functionNames = await discoverEdgeFunctions(
    path.join(rootDir, "supabase", "functions"),
  );

  const shouldSeed = shouldSeedBlueprints(options.skipSeed);
  const shouldUsers = shouldBootstrapUsers(options.env, options.skipUsers);

  const bootstrapUsers = shouldUsers
    ? await loadBootstrapUsers(getBootstrapUsersPath(rootDir, options.env))
    : [];

  const commandPlan = buildCommandPlan({
    envName: options.env,
    target,
    functionNames,
    includePreflight: options.preflight,
    includeSeed: shouldSeed,
    includeUsers: shouldUsers,
    hasDbPassword:
      typeof deployEnv.SUPABASE_DB_PASSWORD === "string" &&
      deployEnv.SUPABASE_DB_PASSWORD.length > 0,
  });

  console.log("\nDeploy target summary");
  console.log(`- environment: ${options.env}`);
  console.log(`- pages project: ${target.pagesProjectName} (${target.pagesBranch})`);
  console.log(`- supabase ref: ${target.supabaseProjectRef}`);
  console.log(`- expected frontend URL: ${target.expectedFrontendUrl}`);
  console.log(`- expected supabase URL: ${target.expectedSupabaseUrl}`);
  console.log(`- edge functions (${functionNames.length}): ${functionNames.join(", ")}`);

  if (options.dryRun) {
    console.log("\nDry run command plan:");
    for (const step of commandPlan) {
      console.log(`- ${formatPlanLine(step)}`);
    }
    console.log("\nDry run complete. No commands were executed.");
    return;
  }

  await runStep("Validate Cloudflare Pages target", async () => {
    await validatePagesProject(target, deployEnv, rootDir);
  });

  await runStep("Validate Supabase project target", async () => {
    await validateSupabaseProject(target, deployEnv, rootDir);
  });

  const functionSecretPairs = buildFunctionSecretPairs(deployEnv);

  for (const step of commandPlan) {
    await runStep(step.title, async () => {
      if (step.id === "backend:set-secrets") {
        const secretArgs = functionSecretPairs.map(([key, value]) => `${key}=${value}`);
        runCommand(
          [
            npxBin,
            "supabase",
            "secrets",
            "set",
            ...secretArgs,
            "--project-ref",
            target.supabaseProjectRef,
          ],
          { cwd: rootDir, env: deployEnv },
        );
        return;
      }

      if (step.id === "backend:seed-storage") {
        const storageSeedEnv = {
          ...deployEnv,
          API_URL: target.expectedSupabaseUrl,
          SERVICE_ROLE_KEY: deployEnv.SUPABASE_SERVICE_ROLE_KEY,
        };

        runCommand(["node", "scripts/seed-storage.mjs"], {
          cwd: rootDir,
          env: storageSeedEnv,
        });
        return;
      }

      if (step.id.startsWith("backend:bootstrap-users:")) {
        await seedAuthUsers({
          supabaseUrl: target.expectedSupabaseUrl,
          serviceRoleKey: deployEnv.SUPABASE_SERVICE_ROLE_KEY,
          users: bootstrapUsers,
        });
        return;
      }

      if (step.id === "verify:smoke") {
        await runSmokeChecks({
          envName: options.env,
          target,
          deployEnv,
          bootstrapUsers,
          verifyBootstrapUsers: shouldUsers,
        });
        return;
      }

      if (step.id === "backend:link") {
        const command = [
          npxBin,
          "supabase",
          "link",
          "--project-ref",
          target.supabaseProjectRef,
        ];
        if (
          typeof deployEnv.SUPABASE_DB_PASSWORD === "string" &&
          deployEnv.SUPABASE_DB_PASSWORD.length > 0
        ) {
          command.push("--password", deployEnv.SUPABASE_DB_PASSWORD);
        }

        runCommand(command, { cwd: rootDir, env: deployEnv });
        return;
      }

      runCommand(step.command, { cwd: rootDir, env: deployEnv });
    });
  }

  console.log("\nDeployment complete.");
  console.log(`Frontend URL: ${target.expectedFrontendUrl}`);
  console.log(`Supabase URL: ${target.expectedSupabaseUrl}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nDeploy failed: ${message}`);
  printUsage();
  process.exit(1);
});
