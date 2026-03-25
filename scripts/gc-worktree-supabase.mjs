#!/usr/bin/env node
/**
 * Garbage-collect orphaned Supabase stacks from deleted worktrees.
 *
 * Invariant: a worktree-specific Supabase stack (project_id matching
 * "mystery-wt-*") is valid if and only if its corresponding worktree
 * directory still exists in `git worktree list`.
 *
 * This script:
 *   1. Lists all running Docker containers labelled with a mystery-wt-* project.
 *   2. Resolves which worktrees are still active.
 *   3. Stops any Supabase stacks whose worktree no longer exists.
 *
 * Safe to run at any time — idempotent, fast (~100 ms when nothing to clean).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { listWorktrees } from "./worktree-ports.mjs";

const WORKTREE_PROJECT_PREFIX = "mystery-wt-";

function docker(...args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

/**
 * Return Set of project_ids for running Supabase containers that match the
 * worktree naming convention.
 */
function runningWorktreeProjects() {
  const result = docker(
    "ps",
    "--filter", "label=com.supabase.cli.project",
    "--format", "{{.Labels}}",
  );

  if (!result.ok) return new Set();

  const ids = new Set();
  for (const line of result.stdout.split(/\r?\n/u)) {
    // Labels are comma-separated key=value pairs.
    for (const pair of line.split(",")) {
      const [key, value] = pair.split("=");
      if (
        key?.trim() === "com.supabase.cli.project" &&
        value?.trim().startsWith(WORKTREE_PROJECT_PREFIX)
      ) {
        ids.add(value.trim());
      }
    }
  }

  return ids;
}

/**
 * Build a set of project_ids that are still valid (their worktree exists).
 */
function activeWorktreeProjectIds(cwd) {
  const worktreePaths = listWorktrees(cwd);
  const active = new Set();

  for (const wtPath of worktreePaths) {
    // Each worktree directory name becomes the suffix in the project_id.
    const leafName = path.basename(wtPath);
    active.add(`${WORKTREE_PROJECT_PREFIX}${leafName.slice(0, 16)}`);
  }

  return active;
}

/**
 * Stop the Supabase stack for a given project_id.
 */
function stopProject(projectId) {
  // The Supabase CLI `supabase stop` doesn't accept a project_id directly,
  // but we can stop all Docker containers with the matching label.
  const listResult = docker(
    "ps",
    "-a",
    "--filter", `label=com.supabase.cli.project=${projectId}`,
    "--format", "{{.ID}}",
  );

  if (!listResult.ok || !listResult.stdout) return 0;

  const containerIds = listResult.stdout.split(/\r?\n/u).filter(Boolean);
  if (containerIds.length === 0) return 0;

  const stopResult = docker("rm", "-f", ...containerIds);
  if (!stopResult.ok) {
    console.warn(`  Warning: failed to remove some containers for ${projectId}: ${stopResult.stderr}`);
  }

  // Also try to remove the associated Docker network.
  const networkName = `supabase_network_${projectId}`;
  docker("network", "rm", networkName);

  return containerIds.length;
}

/**
 * Run garbage collection.  Returns { checked, stopped }.
 */
export function gcWorktreeSupabase(cwd = process.cwd(), { verbose = false } = {}) {
  const running = runningWorktreeProjects();
  if (running.size === 0) {
    if (verbose) console.log("GC: no worktree Supabase stacks running.");
    return { checked: 0, stopped: 0 };
  }

  const active = activeWorktreeProjectIds(cwd);
  let stopped = 0;

  for (const projectId of running) {
    if (active.has(projectId)) {
      if (verbose) console.log(`GC: ${projectId} — worktree active, keeping.`);
      continue;
    }

    console.log(`GC: ${projectId} — worktree gone, stopping…`);
    const removed = stopProject(projectId);
    if (removed > 0) {
      console.log(`GC: removed ${removed} container(s) for ${projectId}.`);
      stopped += 1;
    }
  }

  return { checked: running.size, stopped };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

import { pathToFileURL } from "node:url";

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
  const result = gcWorktreeSupabase(process.cwd(), { verbose });
  if (result.stopped > 0) {
    console.log(`GC complete: stopped ${result.stopped} orphaned stack(s).`);
  } else if (verbose) {
    console.log("GC complete: nothing to clean up.");
  }
}
