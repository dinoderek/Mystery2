/**
 * Recognising the model login's usage limit in a failed attempt's output.
 *
 * The Claude CLI ends a call that hit the limit with an error `result` event,
 * on stdout under `--output-format json` and in the stream file under
 * `stream-json`, whose text is the same message its terminal shows. Version
 * 2.1 builds it as `You've hit your <limit>[ · resets <time>]`, the limit
 * being the 5-hour, weekly or a model's, or a spend limit; with no credit left
 * it says `You're out of usage credits`, and for an organisation's credits
 * `Your organization is out of usage credits`, `Your organization's usage
 * credit cap is reached` or `Your organization's usage credits are capped`
 * (`Your org is out of usage`). Earlier versions said `Claude AI usage limit
 * reached|<reset time>`. A wrapper that prints the message as plain text is
 * read line by line on stderr.
 *
 * Only an error event or stderr is read, never stdout's text, which may be the
 * model's answer, so a judge quoting the words is not taken for the limit.
 */

const MESSAGE =
  /^(?:You['\u2019]ve hit your |You['\u2019]re out of usage credits|Your org(?:anization)?(?:['\u2019]s)? (?:is out of usage|usage credit)|Claude AI usage limit reached)/;

interface ResultEvent {
  type?: unknown;
  is_error?: unknown;
  result?: unknown;
}

function said(text: string): string | null {
  const trimmed = text.trim();
  return MESSAGE.test(trimmed) ? trimmed : null;
}

/** The text of an error `result` event, when `line` is one and says the limit. */
function fromEvent(line: string): string | null {
  let event: ResultEvent;
  try {
    event = JSON.parse(line) as ResultEvent;
  } catch {
    return null;
  }
  if (typeof event !== "object" || event === null || event.type !== "result" || event.is_error !== true) return null;
  return typeof event.result === "string" ? said(event.result) : null;
}

/**
 * What the CLI said about the usage limit in one failed attempt, or null when
 * it said nothing of the kind. `stream` is the attempt's stream file's text,
 * empty when the wrapper streamed nothing.
 */
export function usageLimitMessage(output: { stdout: string; stderr: string; stream: string }): string | null {
  for (const line of [...output.stream.split("\n"), output.stdout]) {
    const found = fromEvent(line.trim());
    if (found) return found;
  }
  for (const line of output.stderr.split("\n")) {
    const found = said(line);
    if (found) return found;
  }
  return null;
}
