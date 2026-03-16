import { describe, expect, it } from "vitest";

import { runDeployPlan, runLoggedStep } from "../../../scripts/deploy-runner.mjs";

interface RunnerStep {
  id: string;
  title: string;
  command: string[];
}

interface RunnerContext {
  phase: string;
  laneName: string | null;
  signal: AbortSignal | null;
}

function makeStep(id: string): RunnerStep {
  return {
    id,
    title: id,
    command: ["echo", id],
  };
}

function makePlan(parallelEnabled = true) {
  return {
    metadata: {
      parallelEnabled,
    },
    serialPreDeploy: [makeStep("pre")],
    parallelDeployLanes: {
      pages: [makeStep("pages")],
      supabase: [makeStep("supabase")],
    },
    serialPostDeploy: [makeStep("post")],
  };
}

describe("runDeployPlan", () => {
  it("runs serial predeploy before lanes and postdeploy after both lanes", async () => {
    const events: string[] = [];

    await runDeployPlan(makePlan(true), {
      executeStep: async (step: RunnerStep, context: RunnerContext) => {
        events.push(`${context.phase}:${context.laneName ?? "none"}:${step.id}:start`);
        if (step.id === "pages") {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (step.id === "supabase") {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        events.push(`${context.phase}:${context.laneName ?? "none"}:${step.id}:end`);
      },
    });

    expect(events[0]).toBe("serial-pre:none:pre:start");
    expect(events[1]).toBe("serial-pre:none:pre:end");
    expect(events).toContain("parallel:pages:pages:start");
    expect(events).toContain("parallel:supabase:supabase:start");
    expect(events.at(-2)).toBe("serial-post:none:post:start");
    expect(events.at(-1)).toBe("serial-post:none:post:end");
  });

  it("waits for the slower lane before running postdeploy steps", async () => {
    let pagesFinished = false;
    let supabaseFinished = false;
    let postObservedBeforeCompletion = false;

    await runDeployPlan(makePlan(true), {
      executeStep: async (step: RunnerStep) => {
        if (step.id === "pages") {
          await new Promise((resolve) => setTimeout(resolve, 25));
          pagesFinished = true;
          return;
        }

        if (step.id === "supabase") {
          await new Promise((resolve) => setTimeout(resolve, 5));
          supabaseFinished = true;
          return;
        }

        if (step.id === "post") {
          postObservedBeforeCompletion = !pagesFinished || !supabaseFinished;
        }
      },
    });

    expect(postObservedBeforeCompletion).toBe(false);
  });

  it("aborts the sibling lane when one lane fails", async () => {
    const events: string[] = [];

    await expect(
      runDeployPlan(makePlan(true), {
        executeStep: async (step: RunnerStep, context: RunnerContext) => {
          events.push(`${context.laneName ?? "none"}:${step.id}:start`);

          if (step.id === "pages") {
            throw new Error("pages exploded");
          }

          if (step.id === "supabase") {
            await new Promise((resolve, reject) => {
              context.signal?.addEventListener(
                "abort",
                () => {
                  events.push("supabase:aborted");
                  reject(new Error("aborted"));
                },
                { once: true },
              );
            });
          }
        },
      }),
    ).rejects.toThrow("pages lane failed: pages exploded");

    expect(events).toContain("supabase:aborted");
    expect(events).not.toContain("none:post:start");
  });

  it("runs pages then supabase sequentially in serial mode", async () => {
    const events: string[] = [];

    await runDeployPlan(makePlan(false), {
      executeStep: async (step: RunnerStep, context: RunnerContext) => {
        events.push(`${context.phase}:${context.laneName ?? "none"}:${step.id}`);
      },
    });

    expect(events).toEqual([
      "serial-pre:none:pre",
      "serial-parallel-lane:pages:pages",
      "serial-parallel-lane:supabase:supabase",
      "serial-post:none:post",
    ]);
  });
});

describe("runLoggedStep", () => {
  it("logs aborted steps without marking them as failed", async () => {
    const messages: string[] = [];
    const logger = {
      log: (message: string) => messages.push(`log:${message}`),
      error: (message: string) => messages.push(`error:${message}`),
    };

    const error = new Error("Command aborted: npx wrangler pages deploy");
    error.name = "AbortError";

    await expect(
      runLoggedStep("Deploy frontend to Cloudflare Pages", async () => {
        throw error;
      }, { logger, prefix: "[pages] " }),
    ).rejects.toBe(error);

    expect(messages).toEqual([
      "log:[pages] [STEP] Deploy frontend to Cloudflare Pages",
      "log:[pages] [ABORTED] Deploy frontend to Cloudflare Pages",
      "log:Command aborted: npx wrangler pages deploy",
    ]);
  });
});
