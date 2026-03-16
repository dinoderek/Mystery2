function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function abortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function decorateLaneError(laneName, error) {
  const message = formatErrorMessage(error);
  const decorated = new Error(`${laneName} lane failed: ${message}`);
  decorated.cause = error;
  return decorated;
}

export async function runLoggedStep(title, action, options = {}) {
  const { logger = console, prefix = "" } = options;
  logger.log(`${prefix}[STEP] ${title}`);
  try {
    await action();
    logger.log(`${prefix}[OK] ${title}`);
  } catch (error) {
    logger.error(`${prefix}[FAIL] ${title}`);
    logger.error(formatErrorMessage(error));
    throw error;
  }
}

async function runStepList(steps, context) {
  const { executeStep, phase, laneName, signal } = context;

  for (const step of steps) {
    if (signal?.aborted) {
      throw abortError(`Aborted before step ${step.id}`);
    }

    await executeStep(step, {
      phase,
      laneName,
      signal,
    });
  }
}

async function runParallelLanes(plan, executeStep) {
  const laneEntries = Object.entries(plan.parallelDeployLanes);
  const controllers = new Map(
    laneEntries.map(([laneName]) => [laneName, new AbortController()]),
  );

  let firstError = null;

  const laneTasks = laneEntries.map(([laneName, steps]) =>
    runStepList(steps, {
      executeStep,
      phase: "parallel",
      laneName,
      signal: controllers.get(laneName).signal,
    }).catch((error) => {
      const decoratedError = decorateLaneError(laneName, error);
      if (!firstError) {
        firstError = decoratedError;
        for (const [otherLaneName, controller] of controllers.entries()) {
          if (otherLaneName !== laneName) {
            controller.abort(firstError);
          }
        }
      }
      throw decoratedError;
    }),
  );

  await Promise.allSettled(laneTasks);

  if (firstError) {
    throw firstError;
  }
}

export async function runDeployPlan(plan, options) {
  const { executeStep } = options;

  await runStepList(plan.serialPreDeploy, {
    executeStep,
    phase: "serial-pre",
    laneName: null,
    signal: null,
  });

  if (plan.metadata.parallelEnabled) {
    await runParallelLanes(plan, executeStep);
  } else {
    for (const [laneName, steps] of Object.entries(plan.parallelDeployLanes)) {
      await runStepList(steps, {
        executeStep,
        phase: "serial-parallel-lane",
        laneName,
        signal: null,
      });
    }
  }

  await runStepList(plan.serialPostDeploy, {
    executeStep,
    phase: "serial-post",
    laneName: null,
    signal: null,
  });
}
