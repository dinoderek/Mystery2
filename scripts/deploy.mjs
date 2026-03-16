import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  assertRequiredDeployEnvVars,
  buildCommandPlan,
  buildDefaultAIProfileConfig,
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
import { runDeployPlan, runLoggedStep } from "./deploy-runner.mjs";
import { npxBin } from "./supabase-utils.mjs";

const DUPLICATE_USER_ERROR =
  /already (?:registered|exists)|has already been registered|duplicate key|user already exists/i;

function runCommandSync(command, options = {}) {
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

function createPrefixedLogger(prefix = "") {
  const prefixText = prefix ? `${prefix} ` : "";
  const write = (method, args) => {
    if (!prefixText) {
      method(...args);
      return;
    }

    if (args.length === 0) {
      method(prefixText.trimEnd());
      return;
    }

    const [first, ...rest] = args;
    method(`${prefixText}${String(first)}`, ...rest);
  };

  return {
    log: (...args) => write(console.log, args),
    warn: (...args) => write(console.warn, args),
    error: (...args) => write(console.error, args),
  };
}

function createOutputPrefixer(prefix, output) {
  let buffer = "";

  const write = (chunk) => {
    buffer += chunk.toString("utf-8");

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      const line = buffer.slice(0, newlineIndex).replace(/\r$/u, "");
      buffer = buffer.slice(newlineIndex + 1);
      output.write(`${prefix}${line}\n`);
    }
  };

  write.flush = () => {
    if (buffer.length > 0) {
      output.write(`${prefix}${buffer.replace(/\r$/u, "")}\n`);
      buffer = "";
    }
  };

  return write;
}

function createCommandAbortError(command) {
  const error = new Error(`Command aborted: ${command.join(" ")}`);
  error.name = "AbortError";
  return error;
}

async function runCommandStreaming(command, options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    signal,
    outputPrefix = "",
  } = options;

  const [binary, ...args] = command;
  const child = spawn(binary, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const writeStdout = createOutputPrefixer(outputPrefix, process.stdout);
  const writeStderr = createOutputPrefixer(outputPrefix, process.stderr);

  child.stdout.on("data", writeStdout);
  child.stderr.on("data", writeStderr);

  const abortHandler = () => {
    if (child.exitCode !== null) {
      return;
    }
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 5000).unref();
  };

  if (signal) {
    if (signal.aborted) {
      abortHandler();
    } else {
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  }

  try {
    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, termSignal) => {
        writeStdout.flush();
        writeStderr.flush();

        if (code === 0) {
          resolve();
          return;
        }

        if (signal?.aborted) {
          reject(createCommandAbortError(command));
          return;
        }

        const suffix = termSignal ? ` (signal ${termSignal})` : "";
        reject(new Error(`Command failed (${code ?? "unknown"}${suffix}): ${command.join(" ")}`));
      });
    });
  } finally {
    if (signal) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

function quoteList(items, fallback = "(none)") {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items.map((item) => `"${item}"`).join(", ");
}

function outputSnippet(text, max = 500) {
  if (typeof text !== "string" || text.length === 0) return "(empty output)";
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

async function validatePagesProject(target, deployEnv, rootDir) {
  let output;
  try {
    output = runCommandSync(
      [npxBin, "wrangler", "pages", "project", "list", "--json"],
      { cwd: rootDir, env: deployEnv, capture: true },
    );
  } catch (error) {
    const accountId = deployEnv.CLOUDFLARE_ACCOUNT_ID || "(missing)";
    const message = error instanceof Error ? error.message : String(error);
    const invalidAccountHint = message.includes("code: 7003")
      ? "\nHint: CLOUDFLARE_ACCOUNT_ID appears invalid for this token/account. Use the Cloudflare account id (not API token, not zone id)."
      : "";
    throw new Error(
      [
        "Cloudflare Pages project list request failed.",
        `CLOUDFLARE_ACCOUNT_ID: "${accountId}"`,
        message + invalidAccountHint,
      ].join("\n"),
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(
      `Unable to parse Cloudflare Pages project list JSON output.\n` +
      `Raw output snippet: ${outputSnippet(output)}`,
    );
  }

  const projects = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.projects)
      ? parsed.projects
      : [];

  const projectNames = projects
    .map((project) => {
      if (!project || typeof project !== "object") return null;
      return (
        project.name ||
        project.project_name ||
        project.projectName ||
        project["Project Name"] ||
        null
      );
    })
    .filter((name) => typeof name === "string" && name.length > 0)
    .sort();

  const found = projectNames.includes(target.pagesProjectName);

  if (!found) {
    const accountId = deployEnv.CLOUDFLARE_ACCOUNT_ID || "(missing)";
    throw new Error(
      [
        `Cloudflare Pages project mismatch.`,
        `expected pagesProjectName: "${target.pagesProjectName}"`,
        `projects returned (${projectNames.length}): ${quoteList(projectNames)}`,
        `CLOUDFLARE_ACCOUNT_ID: "${accountId}"`,
      ].join("\n"),
    );
  }
}

async function validateSupabaseProject(target, deployEnv, rootDir) {
  let output;
  try {
    output = runCommandSync(
      [npxBin, "supabase", "projects", "list", "--output", "json"],
      { cwd: rootDir, env: deployEnv, capture: true },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        "Supabase project list request failed.",
        message,
      ].join("\n"),
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(
      `Unable to parse Supabase projects list JSON output.\n` +
      `Raw output snippet: ${outputSnippet(output)}`,
    );
  }

  const projects = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.projects)
      ? parsed.projects
      : [];

  const availableRefs = [...new Set(projects.flatMap((project) => {
    const candidates = [
      project?.id,
      project?.ref,
      project?.project_ref,
      project?.reference,
    ];
    return candidates.filter(
      (value) => typeof value === "string" && value.length > 0,
    );
  }))].sort();

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
      [
        `Supabase project ref mismatch.`,
        `expected supabaseProjectRef: "${target.supabaseProjectRef}"`,
        `project refs returned (${availableRefs.length}): ${quoteList(availableRefs)}`,
      ].join("\n"),
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

async function seedAuthUsers({ supabaseUrl, serviceRoleKey, users, logger = console }) {
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

  logger.log(
    `Ensured ${users.length} user(s): created=${createdCount}, existing=${existingCount}`,
  );
}

async function configureDefaultAIProfile({
  supabaseUrl,
  serviceRoleKey,
  profile,
}) {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const payload = {
    id: profile.id,
    provider: profile.provider,
    model: profile.model,
    openrouter_api_key: profile.openrouter_api_key,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("ai_profiles").upsert(payload, {
    onConflict: "id",
  });
  if (error) {
    throw new Error(`Failed to configure default ai profile: ${error.message}`);
  }
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
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Frontend URL health check failed for ${url}: ${cause}. ` +
      `Update deploy/targets.json expectedFrontendUrl to a live Pages/custom domain for this environment.`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Frontend URL health check failed (${response.status}) at ${url}. ` +
      `Update deploy/targets.json expectedFrontendUrl if this environment uses a different domain.`,
    );
  }
}

async function assertBlueprintStorageSeeded(adminClient, logger = console) {
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

  logger.log(`Blueprint storage contains ${jsonCount} JSON file(s)`);
}

async function assertBlueprintsListFunctionWorks({
  envName,
  supabaseUrl,
  anonClient,
  adminClient,
  anonKey,
  logger = console,
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

    logger.log(`blueprints-list returned ${payload.blueprints.length} blueprint(s)`);
  } finally {
    if (smokeUserId) {
      const { error } = await adminClient.auth.admin.deleteUser(smokeUserId);
      if (error) {
        logger.warn(`Warning: could not remove smoke-check user ${email}: ${error.message}`);
      }
    }
  }
}

async function assertBootstrapUsersExist(adminClient, users, logger = console) {
  const expected = new Set(users.map((user) => user.email.toLowerCase()));
  const actualEmails = await listAllUserEmails(adminClient);
  const missing = [...expected].filter((email) => !actualEmails.has(email));

  if (missing.length > 0) {
    throw new Error(`Missing expected bootstrap users: ${missing.join(", ")}`);
  }

  logger.log(`Verified ${expected.size} bootstrap user(s)`);
}

async function runSmokeChecks({
  envName,
  target,
  deployEnv,
  bootstrapUsers,
  verifyBootstrapUsers,
  logger = console,
}) {
  const { admin, anon } = createSupabaseClients(
    target.expectedSupabaseUrl,
    deployEnv.SUPABASE_SERVICE_ROLE_KEY,
    deployEnv.VITE_SUPABASE_ANON_KEY,
  );

  await runLoggedStep("Smoke: frontend URL reachable", async () => {
    await assertFrontendReachable(target.expectedFrontendUrl);
  }, { logger });

  await runLoggedStep("Smoke: blueprints bucket seeded", async () => {
    await assertBlueprintStorageSeeded(admin, logger);
  }, { logger });

  await runLoggedStep("Smoke: blueprints-list returns data", async () => {
    await assertBlueprintsListFunctionWorks({
      envName,
      supabaseUrl: target.expectedSupabaseUrl,
      anonClient: anon,
      adminClient: admin,
      anonKey: deployEnv.VITE_SUPABASE_ANON_KEY,
      logger,
    });
  }, { logger });

  if (verifyBootstrapUsers && bootstrapUsers.length > 0) {
    await runLoggedStep("Smoke: bootstrap users exist", async () => {
      await assertBootstrapUsersExist(admin, bootstrapUsers, logger);
    }, { logger });
  }
}

function ensureTargetMatchesEnvContract(target, deployEnv) {
  if (target.expectedSupabaseUrl !== deployEnv.VITE_SUPABASE_URL) {
    throw new Error(
      `Target mismatch: expectedSupabaseUrl (${target.expectedSupabaseUrl}) must match VITE_SUPABASE_URL (${deployEnv.VITE_SUPABASE_URL})`,
    );
  }
}

function printPlanSection(title, steps) {
  console.log(`\n${title}`);
  if (steps.length === 0) {
    console.log("- (none)");
    return;
  }

  for (const step of steps) {
    console.log(`- ${formatPlanLine(step)}`);
  }
}

function printCommandPlan(commandPlan) {
  console.log("\nDry run command plan:");
  printPlanSection("Serial pre-deploy", commandPlan.serialPreDeploy);

  console.log(
    `\nParallel deploy lanes (${commandPlan.metadata.parallelEnabled ? "enabled" : "disabled via --serial"})`,
  );
  printPlanSection("Pages lane", commandPlan.parallelDeployLanes.pages);
  printPlanSection(
    `Supabase lane (functions=${commandPlan.metadata.functionCount}, jobs=${commandPlan.metadata.functionJobs})`,
    commandPlan.parallelDeployLanes.supabase,
  );

  printPlanSection("Serial post-deploy", commandPlan.serialPostDeploy);
}

function createStepExecutionContext(context) {
  const lanePrefix = context.laneName ? `[${context.laneName}]` : "";
  return {
    logger: createPrefixedLogger(lanePrefix),
    outputPrefix: lanePrefix ? `${lanePrefix} ` : "",
  };
}

async function executeDeployStep(step, context, runtime) {
  const { laneName, signal } = context;
  const { logger, outputPrefix } = createStepExecutionContext(context);
  const {
    rootDir,
    deployEnv,
    target,
    defaultAIProfile,
    bootstrapUsers,
    shouldUsers,
  } = runtime;

  await runLoggedStep(step.title, async () => {
    if (step.id === "backend:configure-default-ai-profile") {
      await configureDefaultAIProfile({
        supabaseUrl: target.expectedSupabaseUrl,
        serviceRoleKey: deployEnv.SUPABASE_SERVICE_ROLE_KEY,
        profile: defaultAIProfile,
      });
      return;
    }

    if (step.id === "backend:seed-storage") {
      const storageSeedEnv = {
        ...deployEnv,
        API_URL: target.expectedSupabaseUrl,
        SERVICE_ROLE_KEY: deployEnv.SUPABASE_SERVICE_ROLE_KEY,
      };

      await runCommandStreaming(step.command, {
        cwd: rootDir,
        env: storageSeedEnv,
        signal,
        outputPrefix,
      });
      return;
    }

    if (step.id.startsWith("backend:bootstrap-users:")) {
      await seedAuthUsers({
        supabaseUrl: target.expectedSupabaseUrl,
        serviceRoleKey: deployEnv.SUPABASE_SERVICE_ROLE_KEY,
        users: bootstrapUsers,
        logger,
      });
      return;
    }

    if (step.id === "verify:smoke") {
      await runSmokeChecks({
        envName: runtime.envName,
        target,
        deployEnv,
        bootstrapUsers,
        verifyBootstrapUsers: shouldUsers,
        logger,
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

      await runCommandStreaming(command, {
        cwd: rootDir,
        env: deployEnv,
        signal,
        outputPrefix,
      });
      return;
    }

    await runCommandStreaming(step.command, {
      cwd: rootDir,
      env: deployEnv,
      signal,
      outputPrefix,
    });
  }, {
    logger,
    prefix: laneName ? "" : "\n",
  });
}

function printUsage() {
  console.log(
    "Usage: npm run deploy -- --env <dev|staging|prod> [--preflight] [--dry-run] [--serial] [--function-jobs <n>] [--skip-users] [--skip-seed] [--image-dir <dir>] [--strict-images]",
  );
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
  const defaultAIProfile = buildDefaultAIProfileConfig(deployEnv);
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
    imageDir: options.imageDir,
    allowMissingImages: options.allowMissingImages,
    serial: options.serial,
    functionJobs: options.functionJobs,
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
  console.log(`- deploy mode: ${commandPlan.metadata.parallelEnabled ? "parallel" : "serial"}`);
  console.log(`- function deploy jobs: ${commandPlan.metadata.functionJobs}`);
  console.log(`- default ai profile: ${defaultAIProfile.id} (${defaultAIProfile.provider}, ${defaultAIProfile.model})`);
  console.log(`- image dir: ${options.imageDir ?? "(not set)"}`);
  console.log(`- allow missing images: ${options.allowMissingImages ? "yes" : "no"}`);

  if (options.dryRun) {
    printCommandPlan(commandPlan);
    console.log("\nDry run complete. No commands were executed.");
    return;
  }

  await runLoggedStep("Validate Cloudflare Pages target", async () => {
    await validatePagesProject(target, deployEnv, rootDir);
  });

  await runLoggedStep("Validate Supabase project target", async () => {
    await validateSupabaseProject(target, deployEnv, rootDir);
  });

  await runDeployPlan(commandPlan, {
    executeStep: (step, context) =>
      executeDeployStep(step, context, {
        envName: options.env,
        rootDir,
        deployEnv,
        target,
        defaultAIProfile,
        bootstrapUsers,
        shouldUsers,
      }),
  });

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
