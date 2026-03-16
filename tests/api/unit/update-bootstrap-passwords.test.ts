import { describe, expect, it } from "vitest";

import {
  PASSWORD_UPDATE_ENVIRONMENTS,
  parseUpdateBootstrapPasswordsArgs,
  planBootstrapPasswordUpdates,
} from "../../../scripts/update-bootstrap-passwords.mjs";

describe("parseUpdateBootstrapPasswordsArgs", () => {
  it("accepts env and dry-run", () => {
    expect(
      parseUpdateBootstrapPasswordsArgs(["--env", "dev", "--dry-run"]),
    ).toEqual({
      env: "dev",
      dryRun: true,
    });
  });

  it("supports equals env syntax", () => {
    expect(parseUpdateBootstrapPasswordsArgs(["--env=staging"])).toEqual({
      env: "staging",
      dryRun: false,
    });
  });

  it("rejects missing env", () => {
    expect(() => parseUpdateBootstrapPasswordsArgs([])).toThrow(
      "Missing required --env",
    );
  });

  it("rejects prod", () => {
    expect(() => parseUpdateBootstrapPasswordsArgs(["--env", "prod"])).toThrow(
      "Invalid --env value",
    );
    expect(PASSWORD_UPDATE_ENVIRONMENTS).toEqual(["dev", "staging"]);
  });
});

describe("planBootstrapPasswordUpdates", () => {
  it("matches config users to auth users by normalized email", () => {
    const { updates, missingEmails } = planBootstrapPasswordUpdates(
      [
        {
          email: " Player1@Test.Local ",
          password: "NewPass123!",
          email_confirm: true,
        },
      ],
      new Map([
        [
          "player1@test.local",
          {
            id: "user-1",
            email: "player1@test.local",
          },
        ],
      ]),
    );

    expect(missingEmails).toEqual([]);
    expect(updates).toEqual([
      {
        id: "user-1",
        email: "player1@test.local",
        attributes: {
          password: "NewPass123!",
          email_confirm: true,
        },
      },
    ]);
  });

  it("reports missing users before any updates are attempted", () => {
    const { updates, missingEmails } = planBootstrapPasswordUpdates(
      [{ email: "missing@test.local", password: "NewPass123!" }],
      new Map(),
    );

    expect(updates).toEqual([]);
    expect(missingEmails).toEqual(["missing@test.local"]);
  });

  it("rejects duplicate emails in the config", () => {
    expect(() =>
      planBootstrapPasswordUpdates(
        [
          { email: "duplicate@test.local", password: "NewPass123!" },
          { email: "DUPLICATE@test.local", password: "AnotherPass123!" },
        ],
        new Map(),
      ),
    ).toThrow("Duplicate bootstrap user email");
  });
});
