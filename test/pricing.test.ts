import { describe, expect, it } from "vitest";
import { findModel, normalizeModelId, PRICING } from "../src/pricing";

describe("PRICING database", () => {
  it("contains the required OpenAI models with correct prices", () => {
    const openai = {
      "gpt-4o": [2.5, 10],
      "gpt-4o-mini": [0.15, 0.6],
      o1: [15, 60],
      "o1-mini": [1.1, 4.4],
      "gpt-4.1": [2, 8],
      "gpt-4.1-mini": [0.4, 1.6],
      "gpt-4.1-nano": [0.1, 0.4],
    };
    for (const [model, [input, output]] of Object.entries(openai)) {
      expect(PRICING[model]).toEqual({
        provider: "OpenAI",
        inputPerMillion: input,
        outputPerMillion: output,
      });
    }
  });

  it("contains the required Anthropic models with correct prices", () => {
    const anthropic = {
      "claude-3-7-sonnet": [3, 15],
      "claude-3-5-sonnet": [3, 15],
      "claude-3-5-haiku": [0.8, 4],
      "claude-3-opus": [15, 75],
    };
    for (const [model, [input, output]] of Object.entries(anthropic)) {
      expect(PRICING[model]).toEqual({
        provider: "Anthropic",
        inputPerMillion: input,
        outputPerMillion: output,
      });
    }
  });

  it("contains DeepSeek, Google, xAI, Mistral and Meta models", () => {
    expect(PRICING["deepseek-chat"]).toMatchObject({ inputPerMillion: 0.27, outputPerMillion: 1.1 });
    expect(PRICING["deepseek-reasoner"]).toMatchObject({ inputPerMillion: 0.55, outputPerMillion: 2.19 });
    expect(PRICING["gemini-2.0-flash"]).toMatchObject({ inputPerMillion: 0.1, outputPerMillion: 0.4 });
    expect(PRICING["gemini-2.5-pro"]).toMatchObject({ inputPerMillion: 1.25, outputPerMillion: 10 });
    expect(PRICING["gemini-1.5-pro"]).toMatchObject({ inputPerMillion: 1.25, outputPerMillion: 5 });
    expect(PRICING["grok-2"]).toMatchObject({ inputPerMillion: 2, outputPerMillion: 10 });
    expect(PRICING["grok-beta"]).toMatchObject({ inputPerMillion: 5, outputPerMillion: 15 });
    expect(PRICING["mistral-large"]).toMatchObject({ inputPerMillion: 2, outputPerMillion: 6 });
    expect(PRICING["mistral-small"]).toMatchObject({ inputPerMillion: 0.2, outputPerMillion: 0.6 });
    expect(PRICING["llama-3.3-70b"]).toMatchObject({ inputPerMillion: 0.59, outputPerMillion: 0.79 });
    expect(PRICING["llama-3.1-8b"]).toMatchObject({ inputPerMillion: 0.05, outputPerMillion: 0.08 });
  });

  it("resolves aliases with date suffixes via findModel", () => {
    expect(findModel("gpt-4o")).toBeDefined();
    expect(findModel("gpt-4o-2024-08-06")?.provider).toBe("OpenAI");
    expect(findModel("claude-3-5-sonnet-20241022")?.provider).toBe("Anthropic");
    expect(findModel("does-not-exist")).toBeUndefined();
  });

  it("normalizes model ids", () => {
    expect(normalizeModelId("gpt-4o-2024-08-06")).toBe("gpt-4o");
    expect(normalizeModelId("claude-3-5-sonnet-20241022")).toBe("claude-3-5-sonnet");
    expect(normalizeModelId("azure:gpt-4o")).toBe("gpt-4o");
  });
});