import fs from "node:fs/promises";
import path from "node:path";
import { npmBin, npxBin, parseEnvLine } from "./supabase-utils.mjs";

export const DEPLOY_ENVIRONMENTS = ["dev", "staging", "prod"];

export const REQUIRED_TARGET_KEYS = [
  "pagesProjectName",
  "pagesBranch",
  "supabaseProjectRef",
  "expectedFrontendUrl",
  "expectedSupabaseUrl",
];

export const REQUIRED_DEPLOY_ENV_VARS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AI_DEFAULT_PROFILE_ID",
  "AI_DEFAULT_PROFILE_PROVIDER",
  "AI_DEFAULT_PROFILE_MODEL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
];

const PLACEHOLDER_PASSWORD_PATTERN = /replace[-_ ]?me|change[-_ ]?me|example[-_ ]?password|sample[-_ ]?password/i;

export function parseDeployArgs(argv) {
  const options = {
    env: null,
    preflight: false,
    dryRun: false,
    skipUsers: false,
    skipSeed: false,
    imageDir: null,
    allowMissingImages: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--preflight") {
      options.preflight = true;
      continue;
    }

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (token === "--skip-users") {
      options.skipUsers = true;
      continue;
    }

    if (token === "--skip-seed") {
      options.skipSeed = true;
      continue;
    }

    if (token === "--strict-images") {
      options.allowMissingImages = false;
      continue;
    }

    if (token === "--allow-missing-images") {
      options.allowMissingImages = true;
      continue;
    }

    if (token === "--image-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --image-dir");
      }
      options.imageDir = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--image-dir=")) {
      const value = token.slice("--image-dir=".length);
      if (!value) {
        throw new Error("Missing value for --image-dir");
      }
      options.imageDir = value;
      continue;
    }

    if (token === "--env") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --env (expected dev|staging|prod)");
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
    throw new Error("Missing required --env <dev|staging|prod> option");
  }

  if (!DEPLOY_ENVIRONMENTS.includes(options.env)) {
    throw new Error(
      `Invalid --env value \"${options.env}\" (expected dev|staging|prod)`,
    );
  }

  return options;
}

export async function loadEnvFileVars(filePath, required = false) {
  let contents;
  try {
    contents = await fs.readFile(filePath, "utf-8");
  } catch {
    if (required) {
      throw new Error(`Missing required deploy env file: ${path.basename(filePath)}`);
    }
    return {};
  }

  const vars = {};
  for (const line of contents.split(/\r?\n/u)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    vars[key] = value;
  }

  return vars;
}

export async function loadTargets(targetsPath) {
  let raw;
  try {
    raw = await fs.readFile(targetsPath, "utf-8");
  } catch (error) {
    throw new Error(`Missing required targets manifest: ${targetsPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in targets manifest: ${targetsPath}`);
  }

  validateTargetsShape(parsed);
  return parsed;
}

export function validateTargetsShape(targets) {
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    throw new Error("Deploy targets manifest must be an object keyed by env");
  }

  for (const envName of DEPLOY_ENVIRONMENTS) {
    const envTarget = targets[envName];
    if (!envTarget || typeof envTarget !== "object" || Array.isArray(envTarget)) {
      throw new Error(`Missing target mapping for environment: ${envName}`);
    }

    for (const key of REQUIRED_TARGET_KEYS) {
      if (typeof envTarget[key] !== "string" || envTarget[key].trim().length === 0) {
        throw new Error(`Missing required target key \"${key}\" in environment \"${envName}\"`);
      }
    }
  }
}

export function assertRequiredDeployEnvVars(env) {
  const missing = REQUIRED_DEPLOY_ENV_VARS.filter(
    (key) => typeof env[key] !== "string" || env[key].trim().length === 0,
  );

  const provider = env.AI_DEFAULT_PROFILE_PROVIDER?.trim();
  if (provider === "openrouter") {
    const key = env.AI_DEFAULT_PROFILE_OPENROUTER_API_KEY?.trim();
    if (!key) {
      missing.push("AI_DEFAULT_PROFILE_OPENROUTER_API_KEY");
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required deploy environment variables: ${missing.join(", ")}`,
    );
  }
}

export function buildDefaultAIProfileConfig(env) {
  const id = env.AI_DEFAULT_PROFILE_ID?.trim();
  if (id !== "default") {
    throw new Error(
      `AI_DEFAULT_PROFILE_ID must be exactly \"default\" (received: \"${id || ""}\")`,
    );
  }

  const provider = env.AI_DEFAULT_PROFILE_PROVIDER?.trim();
  if (provider !== "mock" && provider !== "openrouter") {
    throw new Error(
      `AI_DEFAULT_PROFILE_PROVIDER must be \"mock\" or \"openrouter\" (received: \"${provider || ""}\")`,
    );
  }

  const model = env.AI_DEFAULT_PROFILE_MODEL?.trim();
  if (!model) {
    throw new Error("AI_DEFAULT_PROFILE_MODEL must be non-empty");
  }

  const openrouterApiKey = env.AI_DEFAULT_PROFILE_OPENROUTER_API_KEY?.trim();
  if (provider === "openrouter" && !openrouterApiKey) {
    throw new Error(
      "AI_DEFAULT_PROFILE_OPENROUTER_API_KEY is required when AI_DEFAULT_PROFILE_PROVIDER=openrouter",
    );
  }

  return {
    id,
    provider,
    model,
    openrouter_api_key: provider === "openrouter" ? openrouterApiKey : null,
  };
}

export async function discoverEdgeFunctions(functionsDir) {
  let entries;
  try {
    entries = await fs.readdir(functionsDir, { withFileTypes: true });
  } catch {
    throw new Error(`Unable to read Supabase functions directory: ${functionsDir}`);
  }

  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_"))
    .sort();

  if (names.length === 0) {
    throw new Error(
      "No deployable edge functions found under supabase/functions (excluding _shared)",
    );
  }

  return names;
}

export function shouldBootstrapUsers(envName, skipUsers) {
  if (skipUsers) return false;
  return envName !== "prod";
}

export function shouldSeedBlueprints(skipSeed) {
  return !skipSeed;
}

export function getBootstrapUsersPath(rootDir, envName) {
  return path.join(rootDir, `deploy/bootstrap-users.${envName}.local.json`);
}

export function getBootstrapUsersExamplePath(rootDir, envName) {
  return path.join(rootDir, `deploy/bootstrap-users.${envName}.example.json`);
}

export function isPlaceholderPassword(password) {
  return typeof password === "string" && PLACEHOLDER_PASSWORD_PATTERN.test(password);
}

export async function loadBootstrapUsers(usersPath) {
  let raw;
  try {
    raw = await fs.readFile(usersPath, "utf-8");
  } catch {
    const examplePath = usersPath.endsWith(".local.json")
      ? usersPath.replace(/\.local\.json$/u, ".example.json")
      : null;
    const guidance = examplePath
      ? ` Copy ${path.basename(examplePath)} to ${path.basename(usersPath)} and replace the sample passwords.`
      : "";
    throw new Error(`Missing bootstrap user config: ${usersPath}.${guidance}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in bootstrap user config: ${usersPath}`);
  }

  const users = Array.isArray(parsed) ? parsed : parsed.users;
  if (!Array.isArray(users)) {
    throw new Error(`Bootstrap user config must contain a users array: ${usersPath}`);
  }

  for (const [index, user] of users.entries()) {
    if (!user || typeof user !== "object") {
      throw new Error(`Invalid bootstrap user at index ${index}: expected object`);
    }

    if (typeof user.email !== "string" || user.email.trim().length === 0) {
      throw new Error(`Invalid bootstrap user at index ${index}: missing email`);
    }

    if (typeof user.password !== "string" || user.password.length < 6) {
      throw new Error(
        `Invalid bootstrap user at index ${index}: password must be at least 6 chars`,
      );
    }

    if (isPlaceholderPassword(user.password)) {
      throw new Error(
        `Invalid bootstrap user at index ${index}: password must be replaced from the example template`,
      );
    }

    if (
      user.email_confirm !== undefined &&
      typeof user.email_confirm !== "boolean"
    ) {
      throw new Error(
        `Invalid bootstrap user at index ${index}: email_confirm must be boolean when provided`,
      );
    }
  }

  return users;
}

export function buildCommandPlan(options) {
  const {
    envName,
    target,
    functionNames,
    includePreflight,
    includeSeed,
    includeUsers,
    hasDbPassword,
    imageDir,
    allowMissingImages,
  } = options;

  const steps = [];

  if (includePreflight) {
    steps.push(
      {
        id: "preflight:lint",
        title: "Preflight: lint",
        command: [npmBin, "run", "lint"],
      },
      {
        id: "preflight:typecheck",
        title: "Preflight: typecheck",
        command: [npmBin, "run", "typecheck"],
      },
      {
        id: "preflight:test-unit",
        title: "Preflight: test:unit",
        command: [npmBin, "run", "test:unit"],
      },
    );
  }

  steps.push(
    {
      id: "frontend:build",
      title: "Build frontend static artifact",
      command: [npmBin, "-w", "web", "run", "build"],
    },
    {
      id: "frontend:pages-deploy",
      title: "Deploy frontend to Cloudflare Pages",
      command: [
        npxBin,
        "wrangler",
        "pages",
        "deploy",
        "web/build",
        "--project-name",
        target.pagesProjectName,
        "--branch",
        target.pagesBranch,
      ],
    },
  );

  const linkCommand = [
    npxBin,
    "supabase",
    "link",
    "--project-ref",
    target.supabaseProjectRef,
  ];
  if (hasDbPassword) {
    linkCommand.push("--password", "$SUPABASE_DB_PASSWORD");
  }

  steps.push(
    {
      id: "backend:link",
      title: "Link Supabase project",
      command: linkCommand,
      runtimeCommand: hasDbPassword
        ? [
            npxBin,
            "supabase",
            "link",
            "--project-ref",
            target.supabaseProjectRef,
            "--password",
            "$ENV(SUPABASE_DB_PASSWORD)",
          ]
        : undefined,
    },
    {
      id: "backend:db-push",
      title: "Push Supabase migrations",
      command: [npxBin, "supabase", "db", "push", "--linked"],
    },
    {
      id: "backend:configure-default-ai-profile",
      title: "Configure default AI profile row",
      command: ["node", "scripts/deploy.mjs", "<internal:default-ai-profile>"],
    },
  );

  for (const functionName of functionNames) {
    steps.push({
      id: `backend:function:${functionName}`,
      title: `Deploy function: ${functionName}`,
      command: [
        npxBin,
        "supabase",
        "functions",
        "deploy",
        functionName,
        "--project-ref",
        target.supabaseProjectRef,
      ],
    });
  }

  if (includeSeed) {
    const seedCommand = ["node", "scripts/seed-storage.mjs"];
    if (imageDir) {
      seedCommand.push("--seed-images=always", "--image-dir", imageDir);
      if (!allowMissingImages) {
        seedCommand.push("--strict-images");
      }
    }

    steps.push({
      id: "backend:seed-storage",
      title: "Seed blueprint storage",
      command: seedCommand,
    });
  }

  if (includeUsers) {
    steps.push({
      id: `backend:bootstrap-users:${envName}`,
      title: `Bootstrap auth users (${envName})`,
      command: ["node", "scripts/deploy.mjs", "<internal:bootstrap-users>"],
    });
  }

  steps.push({
    id: "verify:smoke",
    title: "Run post-deploy smoke checks",
    command: ["node", "scripts/deploy.mjs", "<internal:smoke-checks>"],
  });

  return steps;
}

export function formatPlanLine(step) {
  return `${step.id.padEnd(30)} ${step.command.join(" ")}`;
}
