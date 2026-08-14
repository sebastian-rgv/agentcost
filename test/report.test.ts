import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appendStore, loadStore } from "../src/store";
import {
  buildReport,
  filterByPeriod,
  parseReportPeriod,
  periodWindow,
} from "../src/report";
import type { ReportPeriod, StoreEntry } from "../src/types";

let home: string;
let previous: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "agentcost-report-"));
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
    ts: new Date().toISOString(),
    model: "gpt-4o",
    provider: "OpenAI",
    inputTokens: 1000,
    outputTokens: 500,
    cost: 0.0075,
    ...overrides,
  };
}

describe("parseReportPeriod", () => {
  it("defaults to week", () => {
    expect(parseReportPeriod(undefined)).toBe("week");
  });

  it("accepts valid periods", () => {
    for (const period of ["today", "week", "month", "all"]) {
      expect(parseReportPeriod(period)).toBe(period);
    }
  });

  it("rejects invalid periods", () => {
    expect(parseReportPeriod("year")).toBeNull();
  });
});

describe("filterByPeriod", () => {
  it("keeps entries inside the window and drops older ones", () => {
    const old = new Date();
    old.setDate(old.getDate() - 40);
    const entries: StoreEntry[] = [
      entry({ ts: new Date().toISOString() }),
      entry({ ts: old.toISOString() }),
    ];
    const week: ReportPeriod = "week";
    const result = filterByPeriod(entries, week);
    expect(result).toHaveLength(1);
    expect(parseReportPeriod("all")).toBe("all");
    expect(filterByPeriod(entries, "all")).toHaveLength(2);
  });

  it("periodWindow returns start before end", () => {
    const window = periodWindow("week");
    expect(new Date(window.start).getTime()).toBeLessThan(new Date(window.end).getTime());
  });
});

describe("buildReport", () => {
  it("aggregates totals, by model, by project and by agent", () => {
    appendStore(entry({ model: "gpt-4o", project: "alpha", agent: "agent-a" }));
    appendStore(
      entry({
        model: "gpt-4o-mini",
        project: "beta",
        agent: "agent-a",
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.00045,
      }),
    );
    const result = buildReport(loadStore(), { period: "all" });
    expect(result.total.calls).toBe(2);
    expect(result.total.inputTokens).toBe(1100);
    expect(result.total.outputTokens).toBe(550);
    expect(result.total.cost).toBeCloseTo(0.0075 + 0.00045, 10);

    expect(result.byModel).toHaveLength(2);
    const gpt4o = result.byModel.find((group) => group.key === "gpt-4o");
    expect(gpt4o?.calls).toBe(1);

    expect(result.byProject.map((group) => group.key)).toEqual(["alpha", "beta"]);
    expect(result.byAgent).toHaveLength(1);
    expect(result.byAgent[0].calls).toBe(2);
  });

  it("excludes old entries from today/week/month windows", () => {
    const old = new Date();
    old.setDate(old.getDate() - 40);
    appendStore(entry({ model: "gpt-4o" }));
    appendStore(entry({ model: "gpt-4o", ts: old.toISOString() }));

    const all = buildReport(loadStore(), { period: "all" });
    const today = buildReport(loadStore(), { period: "today" });
    const week = buildReport(loadStore(), { period: "week" });
    const month = buildReport(loadStore(), { period: "month" });

    expect(all.total.calls).toBe(2);
    expect(today.total.calls).toBe(1);
    expect(week.total.calls).toBe(1);
    expect(month.total.calls).toBe(1);
  });

  it("builds a 7-day trend", () => {
    appendStore(entry({ model: "gpt-4o" }));
    const result = buildReport(loadStore(), { period: "all" });
    expect(result.trend).toHaveLength(7);
    expect(result.trend[6].calls).toBeGreaterThanOrEqual(1);
    expect(result.trend[6].cost).not.toBeNull();
  });

  it("filters by project and agent", () => {
    appendStore(entry({ project: "alpha", agent: "a" }));
    appendStore(entry({ project: "beta", agent: "b" }));
    const alpha = buildReport(loadStore(), { period: "all", project: "alpha" });
    expect(alpha.total.calls).toBe(1);
    const agentB = buildReport(loadStore(), { period: "all", agent: "b" });
    expect(agentB.total.calls).toBe(1);
    expect(agentB.byProject.map((group) => group.key)).toEqual(["beta"]);
  });

  it("limits top models with --top", () => {
    appendStore(entry({ model: "gpt-4o", cost: 10 }));
    appendStore(entry({ model: "gpt-4o-mini", cost: 1 }));
    appendStore(entry({ model: "o1", cost: 5 }));
    const result = buildReport(loadStore(), { period: "all", top: 2 });
    expect(result.topModels?.map((group) => group.key)).toEqual(["gpt-4o", "o1"]);
    expect(result.topModels).toHaveLength(2);
  });
});