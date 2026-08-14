import { describe, expect, it } from "vitest";
import { buildLiveSummary } from "../src/live";
import type { LiveCall } from "../src/types";

describe("buildLiveSummary", () => {
  const base: LiveCall = {
    ts: "2026-08-14T10:00:00.000Z",
    model: "gpt-4o",
    provider: "OpenAI",
    inputTokens: 1000,
    outputTokens: 500,
    cost: 0.0075,
  };

  it("aggregates totals and per-model cost", () => {
    const calls: LiveCall[] = [
      { ...base, agent: "a1", project: "p1" },
      { ...base, ts: "2026-08-14T10:01:00.000Z", agent: "a1", project: "p1" },
    ];
    const summary = buildLiveSummary(calls);
    expect(summary.calls).toBe(2);
    expect(summary.cost).toBeCloseTo(0.015, 10);
    expect(summary.inputTokens).toBe(2000);
    expect(summary.outputTokens).toBe(1000);
    expect(summary.byModel).toHaveLength(1);
    expect(summary.byModel[0].key).toBe("gpt-4o");
    expect(summary.topAgent?.key).toBe("a1");
    expect(summary.topProject?.key).toBe("p1");
    expect(summary.callsPerMinute).toBeCloseTo(2, 5);
  });

  it("sorts models by cost descending", () => {
    const calls: LiveCall[] = [
      { ...base, model: "gpt-4o-mini", cost: 0.001 },
      { ...base, model: "gpt-4o", cost: 0.05 },
    ];
    const summary = buildLiveSummary(calls);
    expect(summary.byModel[0].key).toBe("gpt-4o");
  });

  it("handles unknown cost and no calls", () => {
    const summary = buildLiveSummary([{ ...base, model: "unknown-model", cost: null }]);
    expect(summary.cost).toBeNull();
    expect(summary.topAgent).toBeNull();

    const empty = buildLiveSummary([]);
    expect(empty.calls).toBe(0);
    expect(empty.cost).toBe(0);
    expect(empty.callsPerMinute).toBe(0);
  });

  it("computes per-minute rate from elapsed time", () => {
    const calls: LiveCall[] = [
      { ...base, ts: "2026-08-14T10:00:00.000Z" },
      { ...base, ts: "2026-08-14T10:00:30.000Z" },
    ];
    const summary = buildLiveSummary(calls);
    expect(summary.elapsedSeconds).toBe(30);
    expect(summary.callsPerMinute).toBeCloseTo(4, 5);
  });
});