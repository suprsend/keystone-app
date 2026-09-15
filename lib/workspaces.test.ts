import { describe, it, expect } from "vitest";
import { workspaceKeysFromEnv } from "@/lib/workspaces";

describe("workspaceKeysFromEnv", () => {
  it("finds every workspace with a Workspace Key set, sorted by slug", () => {
    expect(
      workspaceKeysFromEnv({
        SUPRSEND_GLOBEX_WORKSPACE_KEY: "k-globex",
        SUPRSEND_MY_CO_WORKSPACE_KEY: "k-my-co",
        SUPRSEND_ACME_WORKSPACE_KEY: "k-acme",
      }),
    ).toEqual([
      { slug: "acme", key: "k-acme" },
      { slug: "globex", key: "k-globex" },
      { slug: "my-co", key: "k-my-co" },
    ]);
  });

  it("ignores empty keys and other variables", () => {
    expect(
      workspaceKeysFromEnv({
        SUPRSEND_ACME_WORKSPACE_KEY: "",
        SUPRSEND_ACME_WORKSPACE_SECRET: "secret",
        SUPRSEND_SERVICE_TOKEN: "token",
        NEXT_PUBLIC_SUPRSEND_ACME_PUBLIC_KEY: "public",
      }),
    ).toEqual([]);
  });
});
