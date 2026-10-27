import { describe, expect, it, vi } from "vitest";

// The workflow module imports workerd-only modules; stub them for unit tests.
vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: class {} }));
vi.mock("cloudflare:workflows", () => ({ NonRetryableError: class extends Error {} }));

const { rankDuplicates } = await import("./bug-report");

describe("rankDuplicates", () => {
  const issues = [
    { id: "a", title: "Token refresh fails after 7 days", status: "open" },
    { id: "b", title: "Add dark mode to the login page", status: "backlog" },
    { id: "c", title: "Refresh token rotation breaks login", status: "closed" },
    { id: "d", title: "Token refresh returns 401 instead of redirecting", status: "in_progress" },
  ];

  it("finds open issues sharing title words, best first", () => {
    const dupes = rankDuplicates("Token refresh returns 401 after expiry", issues);
    expect(dupes.map((d) => d.id)).toEqual(["d", "a"]);
  });

  it("ignores closed issues and unrelated titles", () => {
    expect(rankDuplicates("Dark login page flickers", issues).map((d) => d.id)).toEqual(["b"]);
    expect(rankDuplicates("Refresh token rotation breaks login", issues).map((d) => d.id)).not.toContain("c");
  });

  it("de-duplicates candidates returned by several searches", () => {
    expect(rankDuplicates("Token refresh fails", [...issues, ...issues])).toHaveLength(2);
  });
});
