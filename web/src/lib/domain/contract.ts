// Reading what the server sent. Every answer the browser acts on passes through
// a schema from `packages/shared`, so a shape the browser does not understand
// stops here, named and logged, instead of half-updating the screen.

/** The part of a Zod schema this needs, so the browser takes no dependency on Zod itself. */
export interface ContractSchema<T> {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> } };
}

export type ContractRead<T> = { ok: true; value: T } | { ok: false; message: string };

function describeIssue(issue: { path: PropertyKey[]; message: string }): string {
  const field = issue.path.map(String).join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}

/**
 * Parses `data` with `schema`. A failure is logged with the endpoint and every
 * issue, and comes back as a message that names the first bad field.
 */
export function readContract<T>(
  schema: ContractSchema<T>,
  data: unknown,
  endpoint: string,
): ContractRead<T> {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  const issues = parsed.error.issues.map(describeIssue);
  console.error(`[contract] ${endpoint} answered something the browser cannot read`, issues);
  return {
    ok: false,
    message: `The game's answer (${endpoint}) was not in the shape this page expects: ${issues[0]}`,
  };
}

/** What `callApi` hands back: the parsed body, or why there is none. */
export interface ApiAnswer {
  data: unknown;
  error: { message: string } | null;
}

/** A failed request stays a failure; a successful one must also match `schema`. */
export function readAnswer<T>(
  answer: ApiAnswer,
  schema: ContractSchema<T>,
  endpoint: string,
): ContractRead<T> {
  if (answer.error) {
    return { ok: false, message: answer.error.message };
  }
  return readContract(schema, answer.data, endpoint);
}
