import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listModels } from "../src/models";

describe("listModels", () => {
  it("lists built-in models and filters by provider", () => {
    const all = listModels();
    expect(all.length).toBeGreaterThan(0);

    const anthropic = listModels("Anthropic");
    expect(anthropic.length).toBeGreaterThan(0);
    expect(anthropic.every((entry) => entry.provider === "Anthropic")).toBe(true);

    const none = listModels("Nonexistent");
    expect(none).toHaveLength(0);
  });

  it("loads overrides from a --pricing-file", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentcost-models-"));
    const file = join(dir, "pricing.json");
    try {
      writeFileSync(
        file,
        JSON.stringify({
          "my-model": { provider: "Acme", inputPerMillion: 1, outputPerMillion: 3 },
          "gpt-4o": { provider: "OpenAI", inputPerMillion: 0.5, outputPerMillion: 1 },
        }),
        "utf8",
      );
      const entries = listModels(undefined, file);
      const custom = entries.find((entry) => entry.name === "my-model");
      expect(custom?.overridden).toBe(true);
      expect(custom?.inputPerMillion).toBe(1);
      expect(custom?.provider).toBe("Acme");

      const gpt4o = entries.find((entry) => entry.name === "gpt-4o");
      expect(gpt4o?.overridden).toBe(true);
      expect(gpt4o?.inputPerMillion).toBe(0.5);

      const untouched = entries.find((entry) => entry.name === "claude-3-5-sonnet");
      expect(untouched?.overridden).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});