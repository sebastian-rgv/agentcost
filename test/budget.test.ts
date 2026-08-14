import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appendStore, loadStore } from "../src/store";
import {
  budgetStatus,
  budgetWarnings,
  checkBudgets,
  listBudgets,
  monthSpend,
  setBudget,
} from "../src/budget";
import type { StoreEntry } from "../src/types";

let home: string;
let previous: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "agentcost-budget-"));
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
  writeFileSync(join(home, "budget.json"), "{}", "utf8");
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

describe("budget", () => {
  it("sets and lists budgets", () => {
    setBudget("alpha", 50);
    const rules = listBudgets();
    expect(rules).toHaveLength(1);
    expect(rules[0].project).toBe("alpha");
    expect(rules[0].monthly).toBe(50);
    expect(rules[0].updatedAt).toBeDefined();
  });

  it("rejects invalid budgets", () => {
    expect(() => setBudget("", 50)).toThrow(/empty/);
    expect(() => setBudget("alpha", -1)).toThrow(/non-negative/);
  });

  it("computes status percentages from the store", () => {
    setBudget("alpha", 100);
    appendStore(entry({ project: "alpha", cost: 50 }));
    const statuses = budgetStatus(loadStore());
    expect(statuses).toHaveLength(1);
    expect(statuses[0].spent).toBeCloseTo(50, 10);
    expect(statuses[0].percent).toBeCloseTo(50, 10);
    expect(statuses[0].level).toBe("ok");
  });

  it("only counts spending for the matching project", () => {
    setBudget("alpha", 100);
    appendStore(entry({ project: "alpha", cost: 10 }));
    appendStore(entry({ project: "beta", cost: 90 }));
    expect(monthSpend(loadStore(), "alpha")).toBeCloseTo(10, 10);
    expect(monthSpend(loadStore(), "beta")).toBeCloseTo(90, 10);
  });

  it("warns at 80% and flags over-budget at 100%", () => {
    setBudget("alpha", 10);
    appendStore(entry({ project: "alpha", cost: 9 }));
    const warningStatus = budgetStatus(loadStore());
    expect(warningStatus[0].level).toBe("warning");
    expect(budgetWarnings(loadStore())).toHaveLength(1);

    appendStore(entry({ project: "alpha", cost: 1 }));
    const statuses = budgetStatus(loadStore());
    expect(statuses[0].level).toBe("over");
    expect(statuses[0].percent).toBeCloseTo(100, 10);

    const { ok } = checkBudgets(loadStore());
    expect(ok).toBe(false);
  });

  it("checkBudgets returns ok when all projects are within budget", () => {
    setBudget("alpha", 100);
    appendStore(entry({ project: "alpha", cost: 50 }));
    const { ok, statuses } = checkBudgets(loadStore());
    expect(ok).toBe(true);
    expect(statuses[0].level).toBe("ok");
  });
});