import net from "node:net";
import { describe, expect, it } from "vitest";

import { assertPortIsFree } from "../../../scripts/lib/test-server.mjs";

const HOST = "127.0.0.1";

/** Listens on an ephemeral port and returns it, with the closer. */
async function listen(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("assertPortIsFree", () => {
  it("rejects when something is already listening", async () => {
    const { port, close } = await listen();
    try {
      await expect(assertPortIsFree(HOST, port)).rejects.toThrow(
        /already listening on 127\.0\.0\.1:/,
      );
    } finally {
      await close();
    }
  });

  it("resolves once the port is free again", async () => {
    const { port, close } = await listen();
    await close();
    await expect(assertPortIsFree(HOST, port)).resolves.toBeUndefined();
  });
});
