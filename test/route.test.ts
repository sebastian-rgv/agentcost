import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { classifyTask, findMatchingPolicy, routeModel } from "../src/route";
import { createSession } from "../src/session";
import { appendStore, loadPolicies, savePolicies } from "../src/store";
import type { PolicyRule, StoreEntry } from "../src/types";

let home: string;
let previous: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "agentcost-route-"));
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
  writeFileSync(join(home, "policy.json"), "[]", "utf8");
});

function entry(overrides: Partial<StoreEntry>): StoreEntry {
  return {
    ts: new Date().toISOString(),
    model: "gpt-4o",
    provider: "OpenAI",
    inputTokens: 1000,
    outputTokens: 500,
    cost: 0.0075,
    ...overrides,
  };
}

describe("classifyTask", () => {
  it("maps task descriptions to task types", () => {
    expect(classifyTask("refactor the auth module")).toBe("coding");
    expect(classifyTask("write a welcome email")).toBe("writing");
    expect(classifyTask("plan the roadmap")).toBe("planning");
    expect(classifyTask("review this PR")).toBe("review");
    expect(classifyTask("extract entities from text")).toBe("classification");
    expect(classifyTask("research the market")).toBe("research");
    expect(classifyTask("hello there")).toBe("general");
  });
});

describe("routeModel", () => {
  it("returns the cheapest model that meets the quality tier", () => {
    const result = routeModel("summarize this text", "medium");
    expect(result.requestedQuality).toBe("medium");
    expect(["low", "medium", "high", "critical"]).toContain(result.tier);
    expect(result.model.length).toBeGreaterThan(0);
    expect(result.reason).toContain("cheapest model meeting quality");
  });

  it("respects max-cost budgets", () => {
    const capped = routeModel("refactor the auth module", "high", { maxCost: 1 });
    const free = routeModel("refactor the auth module", "high");
    expect(capped.blendedPricePerMillion).toBeLessThanOrEqual(1);
    expect(free.model).not.toBe(capped.model);
  });

  it("applies policy allow-lists", () => {
    const rule: PolicyRule = {
      task: "coding",
      quality: "high",
      allow: ["gpt-4o"],
      updatedAt: new Date().toISOString(),
    };
    savePolicies([rule]);
    const result = routeModel("fix this bug", "high");
    expect(result.model).toBe("gpt-4o");
    expect(result.policyMatched).toBe("coding");
    expect(findMatchingPolicy(loadPolicies(), "fix this bug", "high")).toEqual(rule);
  });

  it("downgrades the tier when the session is near its budget", () => {
    const session = createSession("alpha", 10);
    appendStore(entry({ sessionId: session.id, cost: 8 }));
    const downgraded = routeModel("write an email", "high", { sessionId: session.id });
    expect(downgraded.downgraded).toBe(true);
    expect(downgraded.requestedQuality).toBe("high");
  });

  it("falls back to the cheapest available model when nothing meets constraints", () => {
    const result = routeModel("plan a strategy", "critical", { maxCost: 0.0001 });
    expect(result.reason).toContain("fell back to cheapest available");
    expect(result.model.length).toBeGreaterThan(0);
  });
});