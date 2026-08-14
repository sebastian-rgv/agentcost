import { describe, expect, it } from "vitest";
import {
  calculateCost,
  estimate,
  ModelNotFoundError,
  suggestModels,
} from "../src/estimate";
import { PRICING } from "../src/pricing";

describe("calculateCost", () => {
  it("computes cost for gpt-4o at 1000/500 tokens", () => {
    const result = calculateCost(PRICING["gpt-4o"], 1000, 500);
    expect(result.inputCost).toBeCloseTo(0.0025, 10);
    expect(result.outputCost).toBeCloseTo(0.005, 10);
    expect(result.totalCost).toBeCloseTo(0.0075, 10);
  });

  it("returns zero for zero tokens", () => {
    const result = calculateCost(PRICING["gpt-4o-mini"], 0, 0);
    expect(result.totalCost).toBe(0);
  });

  it("scales linearly with token counts", () => {
    const one = calculateCost(PRICING["gpt-4o"], 1_000_000, 1_000_000);
    expect(one.inputCost).toBeCloseTo(2.5, 10);
    expect(one.outputCost).toBeCloseTo(10, 10);
  });
});

describe("estimate", () => {
  it("returns provider and per-part costs", () => {
    const result = estimate("gpt-4o", 1000, 500);
    expect(result.provider).toBe("OpenAI");
    expect(result.model).toBe("gpt-4o");
    expect(result.totalCost).toBeCloseTo(0.0075, 10);
  });

  it("accepts aliases with date suffixes", () => {
    const result = estimate("gpt-4o-2024-08-06", 1000, 500);
    expect(result.provider).toBe("OpenAI");
  });

  it("throws ModelNotFoundError for unknown models", () => {
    expect(() => estimate("nope-4x", 100, 100)).toThrow(ModelNotFoundError);
  });
});

describe("suggestModels", () => {
  it("suggests gpt-4o for a typo", () => {
    const suggestions = suggestModels("gpt-4", 3);
    expect(suggestions).toContain("gpt-4o");
  });

  it("returns a limited number of suggestions", () => {
    const suggestions = suggestModels("claude", 2);
    expect(suggestions.length).toBeLessThanOrEqual(2);
  });
});