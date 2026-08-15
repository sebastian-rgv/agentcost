import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BlockedSessionError, checkSession, reportUsage, UnknownSessionError } from "../src/sdk";
import { loadStore } from "../src/store";

let home: string;
let previous: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "agentcost-sdk-"));
  previous = process.env.AGENTCOST_HOME;
  process.env.AGENTCOST_HOME = home;
});

afterAll(() => {
  if (previous === undefined) delete process.env.AGENTCOST_HOME;
  else process.env.AGENTCOST_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  writeFileSync(join(home, "sessions.json"), "[]", "utf8");
  writeFileSync(join(home, "store.jsonl"), "", "utf8");
});

describe("sdk", () => {
  it("reports usage and persists to the store", () => {
    const saved = reportUsage({
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      project: "alpha",
      task: "refactor auth",
    });
    expect(saved.cost).toBeCloseTo(0.0075, 10);
    expect(saved.task).toBe("refactor auth");
    expect(loadStore()).toHaveLength(1);
  });

  it("computes cost from builtin pricing when not provided", () => {
    const saved = reportUsage({ model: "claude-3-5-sonnet", inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(saved.cost).toBeCloseTo(18, 10);
  });

  it("accepts an explicit cost and provider", () => {
    const saved = reportUsage({
      model: "custom-model",
      provider: "Custom",
      inputTokens: 10,
      outputTokens: 10,
      cost: 0.99,
    });
    expect(saved.cost).toBe(0.99);
    expect(saved.provider).toBe("Custom");
  });

  it("throws on unknown sessions", () => {
    expect(() => reportUsage({ model: "gpt-4o", inputTokens: 1, outputTokens: 1, sessionId: "ses_missing" }))
      .toThrow(UnknownSessionError);
  });

  it("throws on blocked sessions (kill switch)", async () => {
    const { createSession, blockSession } = await import("../src/session");
    const session = createSession("alpha", 5);
    blockSession(session.id);
    expect(() => reportUsage({ model: "gpt-4o", inputTokens: 1, outputTokens: 1, sessionId: session.id }))
      .toThrow(BlockedSessionError);
  });

  it("checkSession reports ok and over states", async () => {
    const { createSession } = await import("../src/session");
    const session = createSession("alpha", 10);
    reportUsage({ model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 1_000_000, sessionId: session.id, cost: 12 });
    const result = checkSession(session.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("session over limit");
    expect(result.status.percent).toBeGreaterThan(100);
  });
});