/**
 * Recognising the model login's usage limit in a failed attempt's output.
 *
 * The Claude CLI ends a call that hit the limit with an error `result` event,
 * on stdout under `--output-format json` and in the stream file under
 * `stream-json`, whose text is the same message its terminal shows. The
 * prefixes below are the ones the CLI itself (version 2.1) classes as a usage
 * limit, such as `You've hit your 5-hour limit · resets 3pm` or `You've
 * reached your Opus limit`, with its `<model> requires usage credits.`; then
 * the organisation's credits running out, and the wording of earlier versions,
 * `Claude AI usage limit reached|<reset time>`. Its warnings (`You've used`,
 * `You're close to`) are not limits. A wrapper that prints the message as
 * plain text is read line by line on stderr.
 *
 * Only an error event or stderr is read, never stdout's text, which may be the
 * model's answer, so a judge quoting the words is not taken for the limit.
 */

const PREFIXES = [
  // The CLI's own list.
  "You've hit your",
  "You've reached your",
  "You're out of usage credits",
  "Your org is out of usage",
  "Your seat type doesn't include usage credits",
  "Your seat type doesn't include usage",
  "Your seat type doesn't include extra usage",
  "Your usage allocation has been disabled by your admin",
  "Your group's usage limit is set to $0",
  "You're out of extra usage",
  // An organisation's credits, and earlier versions.
  "Your organization is out of usage credits",
  "Your organization's usage credit",
  "Claude AI usage limit reached",
];
const MODEL_CREDITS = /^(?:Fable|Haiku|Mythos|Opus|Sonnet)(?: [^\u00B7\n]{1,40})? requires usage credits\./;

interface ResultEvent {
  type?: unknown;
  is_error?: unknown;
  result?: unknown;
}

function said(text: string): string | null {
  const trimmed = text.trim();
  // A typographic apostrophe reads as a plain one.
  const plain = trimmed.replaceAll("\u2019", "'");
  return PREFIXES.some((prefix) => plain.startsWith(prefix)) || MODEL_CREDITS.test(plain) ? trimmed : null;
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
