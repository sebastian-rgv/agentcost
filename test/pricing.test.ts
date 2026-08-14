import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findModel, normalizeModelId, PRICING } from "../src/pricing";
import { allPricingEntries, resetOverrides, resolveModel, syncPricing } from "../src/pricing";
import { estimate } from "../src/estimate";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("pricing overrides (AGENTCOST_HOME)", () => {
  let home: string;
  let previous: string | undefined;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "agentcost-pricing-"));
    previous = process.env.AGENTCOST_HOME;
    process.env.AGENTCOST_HOME = home;
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.AGENTCOST_HOME;
    else process.env.AGENTCOST_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  });

  beforeEach(() => {
    rmSync(join(home, "pricing.json"), { force: true });
  });

  it("syncs pricing from a local file and applies the override", async () => {
    const registry = join(home, "registry.json");
    writeFileSync(
      registry,
      JSON.stringify({
        "gpt-4o": {
          provider: "OpenAI",
          inputPerMillion: 1,
          outputPerMillion: 2,
          updatedAt: "2026-08-14T00:00:00.000Z",
        },
      }),
    );
    const result = await syncPricing(registry);
    expect(result.models).toContain("gpt-4o");

    const resolved = resolveModel("gpt-4o");
    expect(resolved?.overridden).toBe(true);
    expect(resolved?.pricing.inputPerMillion).toBe(1);
    expect(resolved?.pricing.outputPerMillion).toBe(2);

    const entries = allPricingEntries();
    expect(entries.find((entry) => entry.name === "gpt-4o")?.source).toBe("override");
    expect(entries.find((entry) => entry.name === "gpt-4o")?.overridden).toBe(true);
  });

  it("uses overrides in estimate", async () => {
    writeFileSync(
      join(home, "pricing.json"),
      JSON.stringify({
        "gpt-4o": { provider: "OpenAI", inputPerMillion: 1, outputPerMillion: 2 },
      }),
    );
    const result = estimate("gpt-4o", 1_000_000, 0);
    expect(result.overridden).toBe(true);
    expect(result.inputCost).toBeCloseTo(1, 10);
  });

  it("reset removes local overrides", async () => {
    writeFileSync(
      join(home, "pricing.json"),
      JSON.stringify({ o1: { provider: "OpenAI", inputPerMillion: 1, outputPerMillion: 2 } }),
    );
    expect(resolveModel("o1")?.overridden).toBe(true);
    expect(resetOverrides()).toBe(true);
    expect(resolveModel("o1")?.overridden).toBe(false);
  });

  it("returns clear error for a missing local file", async () => {
    await expect(syncPricing("/nonexistent/pricing.json")).rejects.toThrow(/Cannot read pricing file/);
  });
});