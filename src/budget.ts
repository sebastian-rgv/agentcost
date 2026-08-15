import pc from "picocolors";
import type { Command } from "commander";
import type { BudgetLevel, BudgetRule, BudgetStatus, BudgetWarning, StoreEntry } from "./types";
import { loadBudgets, loadStore, saveBudgets } from "./store";
import { formatMoney, renderTable } from "./types";

export function currentMonthKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function setBudget(project: string, monthly: number): BudgetRule {
  const budgets = loadBudgets();
  const key = project.trim();
  if (key.length === 0) {
    throw new Error("Project name cannot be empty.");
  }
  if (!Number.isFinite(monthly) || monthly < 0) {
    throw new Error("Monthly budget must be a non-negative number.");
  }
  const rule: BudgetRule = { project: key, monthly, updatedAt: new Date().toISOString() };
  budgets[key] = rule;
  saveBudgets(budgets);
  return rule;
}

export function listBudgets(): BudgetRule[] {
  return Object.values(loadBudgets()).sort((a, b) => a.project.localeCompare(b.project));
}

export function monthSpend(entries: StoreEntry[], project: string): number {
  const month = currentMonthKey();
  return entries.reduce((sum, entry) => {
    if (entry.project !== project) return sum;
    if (entry.ts.slice(0, 7) !== month) return sum;
    return sum + (entry.cost ?? 0);
  }, 0);
}

export function budgetStatus(entries: StoreEntry[]): BudgetStatus[] {
  const rules = listBudgets();
  return rules.map((rule) => {
    const spent = monthSpend(entries, rule.project);
    const percent = rule.monthly === 0 ? (spent > 0 ? Infinity : 0) : (spent / rule.monthly) * 100;
    let level: BudgetStatus["level"] = "ok";
    if (percent >= 100) level = "over";
    else if (percent >= 80) level = "warning";
    return { project: rule.project, monthly: rule.monthly, spent, percent, level };
  });
}

export function budgetWarnings(entries: StoreEntry[]): BudgetWarning[] {
  return budgetStatus(entries)
    .filter((status) => status.level === "warning" || status.level === "over")
    .map((status) => ({
      project: status.project,
      monthly: status.monthly,
      spent: status.spent,
      percent: status.percent,
    }));
}

export function checkBudgets(entries: StoreEntry[]): {
  ok: boolean;
  statuses: BudgetStatus[];
} {
  const statuses = budgetStatus(entries);
  return { ok: statuses.every((status) => status.level !== "over"), statuses };
}

function levelColor(level: BudgetLevel): (text: string) => string {
  if (level === "over") return pc.red;
  if (level === "warning") return pc.yellow;
  return pc.green;
}

function percentText(status: BudgetStatus): string {
  if (!Number.isFinite(status.percent)) return "over";
  return `${status.percent.toFixed(1)}%`;
}

export function attachBudgetCommand(program: Command): void {
  const budget = program
    .command("budget")
    .description("Manage monthly budgets per project");
  budget
    .command("set")
    .description("Set a monthly budget for a project")
    .requiredOption("--project <name>", "project name")
    .requiredOption("--monthly <amount>", "monthly budget in USD")
    .action((options: { project: string; monthly: string }) => {
      const monthly = parseFloat(options.monthly);
      try {
        const rule = setBudget(options.project, monthly);
        process.stdout.write(
          `Budget set for '${rule.project}': $${formatMoney(rule.monthly)}/month.\n`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      }
    });
  budget
    .command("list")
    .description("List budgets and their current consumption")
    .action(() => {
      const rules = listBudgets();
      if (rules.length === 0) {
        process.stdout.write("No budgets set. Use 'agentcost budget set' first.\n");
        return;
      }
      const statuses = budgetStatus(loadStore());
      const headers = ["Project", "Monthly", "Spent", "Percent"];
      const rows = statuses.map((status) => [
        status.project,
        `$${formatMoney(status.monthly)}`,
        `$${formatMoney(status.spent)}`,
        percentText(status),
      ]);
      process.stdout.write(
        renderTable(headers, rows, (row, col, text) => {
          if (row >= 0 && col === 3) return levelColor(statuses[row].level)(text);
          if (col === 0) return pc.cyan(text);
          return text;
        }) + "\n",
      );
    });
  budget
    .command("check")
    .description("Check budgets; exit 1 if any project is over budget")
    .action(async () => {
      const { ok, statuses } = checkBudgets(loadStore());
      if (statuses.length === 0) {
        process.stdout.write("No budgets set.\n");
        return;
      }
      const alerts = statuses.filter((status) => status.level === "warning" || status.level === "over");
      if (alerts.length > 0) {
        const { evaluateAlertsForThresholds } = await import("./alerts");
        await evaluateAlertsForThresholds(
          alerts.map((status) => ({
            name: status.project,
            limit: status.monthly,
            spent: status.spent,
            percent: status.percent,
            kind: "budget" as const,
          })),
        );
      }
      const headers = ["Project", "Monthly", "Spent", "Percent", "Status"];
      const rows = statuses.map((status) => [
        status.project,
        `$${formatMoney(status.monthly)}`,
        `$${formatMoney(status.spent)}`,
        percentText(status),
        status.level,
      ]);
      process.stdout.write(
        renderTable(headers, rows, (row, col, text) => {
          if (row >= 0 && col === 4) return levelColor(statuses[row].level)(text);
          if (col === 0) return pc.cyan(text);
          return text;
        }) + "\n",
      );
      if (!ok) {
        process.stderr.write(
          "One or more projects are over budget (usage >= 100% of the monthly budget).\n",
        );
        process.exitCode = 1;
      }
    });
}