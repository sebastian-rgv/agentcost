import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { detectLoops, optimizeProject } from "../src/optimize";
import { appendStore, loadStore } from "../src/store";
import type { StoreEntry } from "../src/types";

let home: string;
let previous: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "agentcost-optimize-"));
  previous = process.env.AGENTCOST_HOME;
  process.env.AGENTCOST_HOME = home;
});

afterAll(() => {
  if (previous === undefined) delete process.env.AGENTCOST_HOME;
  else process.env.AGENTCOST_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  writeFileSync(join(home, "store.jsonl"), "", "utf8");
});

function entry(ts: string, overrides: Partial<StoreEntry>): StoreEntry {
  return {
    ts,
    model: "gpt-4o",
    provider: "OpenAI",
    inputTokens: 1000,
    outputTokens: 500,
    cost: 0.0075,
    project: "alpha",
    ...overrides,
  };
}

describe("detectLoops", () => {
  it("detects retry storms from kind markers", () => {
    const base = "2026-08-14T10:00:00.000Z";
    for (let i = 0; i < 4; i += 1) {
      const ts = new Date(Date.parse(base) + i * 10_000).toISOString();
      appendStore(entry(ts, { kind: "retry" }));
    }
    const loops = detectLoops(loadStore(), "alpha");
    const retry = loops.find((loop) => loop.type === "retry-storm");
    expect(retry).toBeDefined();
    expect(retry?.count).toBe(4);
  });

  it("detects tool-call storms from rapid consecutive calls", () => {
    const base = "2026-08-14T10:00:00.000Z";
    for (let i = 0; i < 8; i += 1) {
      const ts = new Date(Date.parse(base) + i * 1000).toISOString();
      appendStore(entry(ts, { toolCalls: 3 }));
    }
    const loops = detectLoops(loadStore(), "alpha");
    const storm = loops.find((loop) => loop.type === "tool-storm");
    expect(storm).toBeDefined();
    expect(storm!.count).toBeGreaterThanOrEqual(8);
  });

  it("detects context pressure when input tokens approach the context window", () => {
    const base = "2026-08-14T10:00:00.000Z";
    for (let i = 0; i < 4; i += 1) {
      const ts = new Date(Date.parse(base) + i * 60_000).toISOString();
      appendStore(entry(ts, { inputTokens: 120_000, contextWindow: 128_000 }));
    }
    const loops = detectLoops(loadStore(), "alpha");
    expect(loops.some((loop) => loop.type === "context-pressure")).toBe(true);
  });

  it("returns no loops for clean usage", () => {
    appendStore(entry("2026-08-14T10:00:00.000Z", {}));
    appendStore(entry("2026-08-14T11:00:00.000Z", {}));
    expect(detectLoops(loadStore(), "alpha")).toHaveLength(0);
  });
});

describe("optimizeProject", () => {
  it("suggests cheaper models with real cost data", () => {
    const base = "2026-08-14T10:00:00.000Z";
    for (let i = 0; i < 10; i += 1) {
      const ts = new Date(Date.parse(base) + i * 60_000).toISOString();
      appendStore(entry(ts, { model: "o1", inputTokens: 200_000, outputTokens: 50_000, cost: 5.5 }));
    }
    const result = optimizeProject("alpha");
    expect(result.project).toBe("alpha");
    const suggestion = result.suggestions.find((s) => s.model === "o1");
    expect(suggestion).toBeDefined();
    expect(suggestion?.suggestedModel.length).toBeGreaterThan(0);
    expect(suggestion?.estSaving).toBeGreaterThan(0);
    expect(suggestion?.reasons.length).toBeGreaterThan(0);
  });
});