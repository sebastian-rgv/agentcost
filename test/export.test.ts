import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appendStore, loadStore } from "../src/store";
import { buildClientExport, renderClientExportCsv } from "../src/export";
import type { StoreEntry } from "../src/types";

let home: string;
let previous: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "agentcost-export-"));
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

function entry(overrides: Partial<StoreEntry>): StoreEntry {
  return {
    ts: "2026-08-14T10:00:00.000Z",
    model: "gpt-4o",
    provider: "OpenAI",
    inputTokens: 1000,
    outputTokens: 500,
    cost: 0.0075,
    project: "alpha",
    agent: "coder",
    ...overrides,
  };
}

describe("client export", () => {
  it("builds totals and groups by project and agent", () => {
    appendStore(entry({}));
    appendStore(entry({ project: "beta", cost: 1 }));
    const result = buildClientExport("acme", loadStore());
    expect(result.client).toBe("acme");
    expect(result.total.calls).toBe(2);
    expect(result.total.cost).toBeCloseTo(1.0075, 10);
    expect(result.byProject).toHaveLength(2);
    expect(result.byAgent[0].key).toBe("coder");
    expect(result.rows).toHaveLength(2);
  });

  it("renders a CSV with totals and line items", () => {
    appendStore(entry({}));
    const csv = renderClientExportCsv(buildClientExport("acme", loadStore()));
    expect(csv).toContain("Client,acme");
    expect(csv).toContain("Total calls,1");
    expect(csv).toContain("gpt-4o");
    expect(csv).toContain("$0.0075");
  });
});