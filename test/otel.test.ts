import { describe, expect, it } from "vitest";
import { metricsFromStore, toOtlpJson } from "../src/otel";
import type { StoreEntry } from "../src/types";

function entry(overrides: Partial<StoreEntry>): StoreEntry {
  return {
    ts: "2026-08-14T10:00:00.000Z",
    model: "gpt-4o",
    provider: "OpenAI",
    inputTokens: 1000,
    outputTokens: 500,
    cost: 0.0075,
    project: "alpha",
    ...overrides,
  };
}

describe("otel", () => {
  it("builds per-model cost metrics with tags", () => {
    const metrics = metricsFromStore(
      [entry({}), entry({}), entry({ model: "gpt-4o-mini", cost: 0.001 })],
      { project: "alpha" },
    );
    const cost = metrics.find((m) => m.name === "agentcost.cost.total");
    expect(cost?.value).toBeCloseTo(0.016, 10);
    const calls = metrics.find((m) => m.name === "agentcost.calls" && m.tags.model === "gpt-4o");
    expect(calls?.value).toBe(2);
    expect(calls?.tags.project).toBe("alpha");
  });

  it("serializes to OTLP JSON with resource attributes", () => {
    const otlp = toOtlpJson([{ name: "agentcost.cost.total", value: 1.5, tags: { project: "x" } }]) as {
      resourceMetrics: Array<{ resource: { attributes: Array<{ key: string }> } }>;
    };
    expect(otlp.resourceMetrics[0].resource.attributes[0].key).toBe("service.name");
  });
});