// Which `Host` headers a server reached from other devices answers.
//
// `./dev run --lan` serves the game on every interface. A page on any site the
// player visits could then point a name of its own at this machine (DNS
// rebinding) and drive the game as if it were the player's own page, so a
// server started with an allow-list answers only an IP address, `localhost`,
// or a name on the list. Without the variable there is no check: a server on
// loopback cannot be reached by name from elsewhere.

import { isIP } from "node:net";

/** Comma-separated host names, without ports, that the server answers besides IP addresses and `localhost`. */
export const ALLOWED_HOSTS_ENV = "MYSTERY_ALLOWED_HOSTS";

/** Lower-cased, without a trailing dot: how DNS names compare. */
function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * The names in `MYSTERY_ALLOWED_HOSTS`, or null when it is unset or empty,
 * which means every host is answered.
 */
export function parseAllowedHosts(value: string | undefined): string[] | null {
  const names = (value ?? "").split(",").map(normaliseName).filter(Boolean);
  return names.length > 0 ? names : null;
}

/** The host name in a `Host` header: without its port, and without the brackets of an IPv6 literal. */
export function hostNameOf(header: string): string {
  const trimmed = header.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  const colon = trimmed.lastIndexOf(":");
  return normaliseName(colon === -1 ? trimmed : trimmed.slice(0, colon));
}

/** Whether a request with this `Host` header is answered. A request without one is not. */
export function isHostAllowed(header: string | null, allowed: readonly string[]): boolean {
  if (!header?.trim()) return false;
  const name = hostNameOf(header);
  return isIP(name) !== 0 || name === "localhost" || allowed.includes(name);
}
