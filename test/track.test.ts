import { describe, expect, it } from "vitest";
import { aggregate, parseUsageLine, trackJsonl } from "../src/track";
import type { UsageRecord } from "../src/types";

const openaiLine = JSON.stringify({
  model: "gpt-4o",
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
});

const anthropicLine = JSON.stringify({
  model: "claude-3-5-sonnet",
  usage: { input_tokens: 2000, output_tokens: 800 },
});

describe("parseUsageLine", () => {
  it("parses OpenAI format", () => {
    const result = parseUsageLine(JSON.parse(openaiLine), 1);
    expect(result).toEqual<UsageRecord>({
      kind: "openai",
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      line: 1,
    });
  });

  it("parses Anthropic format", () => {
    const result = parseUsageLine(JSON.parse(anthropicLine), 2);
    expect(result).toEqual<UsageRecord>({
      kind: "anthropic",
      model: "claude-3-5-sonnet",
      inputTokens: 2000,
      outputTokens: 800,
      line: 2,
    });
  });

  it("returns null for records without usage or model", () => {
    expect(parseUsageLine({ model: "gpt-4o" }, 1)).toBeNull();
    expect(parseUsageLine({ usage: { prompt_tokens: 1 } }, 1)).toBeNull();
    expect(parseUsageLine("not an object", 1)).toBeNull();
    expect(parseUsageLine({ model: "gpt-4o", usage: { foo: 1 } }, 1)).toBeNull();
  });

  it("detects format by fields even when other keys are present", () => {
    const rec = {
      id: "x",
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      extra: { whatever: true },
    };
    const result = parseUsageLine(rec, 1);
    expect(result?.kind).toBe("openai");
  });
});

describe("trackJsonl", () => {
  it("aggregates OpenAI logs by model", () => {
    const text = [openaiLine, openaiLine, JSON.stringify({
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    })].join("\n");
    const result = trackJsonl(text);
    expect(result.total.calls).toBe(3);
    expect(result.total.inputTokens).toBe(2100);
    expect(result.total.outputTokens).toBe(1050);
    expect(result.total.skipped).toBe(0);
    const gpt4o = result.models.find((m) => m.model === "gpt-4o");
    expect(gpt4o?.calls).toBe(2);
    expect(gpt4o?.cost).toBeCloseTo(2 * (0.0025 + 0.005), 10);
  });

  it("aggregates Anthropic logs and computes cost", () => {
    const result = trackJsonl(anthropicLine + "\n");
    expect(result.total.calls).toBe(1);
    const sonnet = result.models.find((m) => m.model === "claude-3-5-sonnet");
    expect(sonnet?.provider).toBe("Anthropic");
    expect(sonnet?.cost).toBeCloseTo(0.006 + 0.012, 10);
  });

  it("handles mixed formats and unknown models gracefully", () => {
    const text = [openaiLine, anthropicLine, "not json", JSON.stringify({ model: "x", usage: {} })].join("\n");
    const result = trackJsonl(text);
    expect(result.total.skipped).toBe(2);
    expect(result.total.calls).toBe(2);
    const unknown = result.models.find((m) => m.model === "x");
    expect(unknown).toBeUndefined();
  });

  it("skips malformed and empty lines", () => {
    const result = trackJsonl("hello\n\n{broken\n");
    expect(result.total.calls).toBe(0);
    expect(result.total.skipped).toBe(2);
  });
});

describe("aggregate", () => {
  it("marks unknown models with cost null", () => {
    const records: UsageRecord[] = [
      { kind: "openai", model: "weird-model", inputTokens: 10, outputTokens: 10, line: 1 },
    ];
    const result = aggregate(records);
    expect(result.models[0].cost).toBeNull();
    expect(result.models[0].provider).toBe("unknown");
    expect(result.total.cost).toBeNull();
  });

  it("computes total cost as sum of known model costs", () => {
    const records: UsageRecord[] = [
      { kind: "openai", model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 0, line: 1 },
      { kind: "openai", model: "gpt-4o-mini", inputTokens: 0, outputTokens: 1_000_000, line: 2 },
    ];
    const result = aggregate(records);
    expect(result.total.cost).toBeCloseTo(3.1, 10);
  });

  it("sorts models by cost descending", () => {
    const records: UsageRecord[] = [
      { kind: "openai", model: "gpt-4o-mini", inputTokens: 100_000, outputTokens: 0, line: 1 },
      { kind: "openai", model: "gpt-4o", inputTokens: 100_000, outputTokens: 0, line: 2 },
    ];
    const result = aggregate(records);
    expect(result.models[0].model).toBe("gpt-4o");
    expect(result.models[1].model).toBe("gpt-4o-mini");
  });
});