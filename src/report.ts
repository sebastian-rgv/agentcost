import pc from "picocolors";
import type { Command } from "commander";
import { budgetWarnings } from "./budget";
import { loadStore } from "./store";
import { formatMoney, renderTable } from "./types";
import type {
  ReportGroup,
  ReportPeriod,
  ReportResult,
  ReportTotals,
  StoreEntry,
  TrendPoint,
} from "./types";

export function parseReportPeriod(value: string | undefined): ReportPeriod | null {
  if (value === undefined) return "week";
  const normalized = value.trim().toLowerCase();
  if (normalized === "today" || normalized === "week" || normalized === "month" || normalized === "all") {
    return normalized;
  }
  return null;
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDayLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function periodWindow(period: ReportPeriod, now: Date = new Date()): { start: string; end: string } {
  const end = now.toISOString();
  switch (period) {
    case "all":
      return { start: "1970-01-01T00:00:00.000Z", end };
    case "today":
      return { start: startOfDayLocal(now).toISOString(), end };
    case "week": {
      const start = new Date(now.getTime());
      start.setDate(start.getDate() - 6);
      return { start: startOfDayLocal(start).toISOString(), end };
    }
    case "month": {
      const start = new Date(now.getTime());
      start.setDate(start.getDate() - 29);
      return { start: startOfDayLocal(start).toISOString(), end };
    }
  }
}

export function filterByPeriod(entries: StoreEntry[], period: ReportPeriod): StoreEntry[] {
  const { start, end } = periodWindow(period);
  return entries.filter((entry) => entry.ts >= start && entry.ts <= end);
}

export function filterByContext(
  entries: StoreEntry[],
  project?: string,
  agent?: string,
): StoreEntry[] {
  return entries.filter((entry) => {
    if (project !== undefined && entry.project !== project) return false;
    if (agent !== undefined && entry.agent !== agent) return false;
    return true;
  });
}

function sumCost(window: StoreEntry[]): number | null {
  let total = 0;
  let hasUnknown = false;
  for (const entry of window) {
    if (entry.cost === null) hasUnknown = true;
    else total += entry.cost;
  }
  return hasUnknown ? null : total;
}

interface GroupAccumulator {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

function aggregateGroup(entries: StoreEntry[], keyOf: (entry: StoreEntry) => string | undefined): ReportGroup[] {
  const groups = new Map<string, GroupAccumulator>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (key === undefined) continue;
    const group = groups.get(key) ?? {
      key,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    };
    group.calls += 1;
    group.inputTokens += entry.inputTokens;
    group.outputTokens += entry.outputTokens;
    if (entry.cost !== null) group.cost += entry.cost;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ key: group.key, calls: group.calls, inputTokens: group.inputTokens, outputTokens: group.outputTokens, cost: group.cost }))
    .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || a.key.localeCompare(b.key));
}

export function buildTrend(entries: StoreEntry[], now: Date = new Date()): TrendPoint[] {
  const days: TrendPoint[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(now.getTime());
    day.setDate(day.getDate() - i);
    const key = localDateKey(day);
    const window = entries.filter((entry) => localDateKey(new Date(entry.ts)) === key);
    const cost = sumCost(window);
    days.push({ date: key, calls: window.length, cost });
  }
  return days;
}

export interface ReportOptions {
  period: ReportPeriod;
  project?: string;
  agent?: string;
  top?: number;
}

export function buildReport(entries: StoreEntry[], options: ReportOptions): ReportResult {
  const period = options.period;
  const contextFiltered = filterByContext(filterByPeriod(entries, period), options.project, options.agent);
  const total: ReportTotals = {
    calls: contextFiltered.length,
    inputTokens: contextFiltered.reduce((sum, e) => sum + e.inputTokens, 0),
    outputTokens: contextFiltered.reduce((sum, e) => sum + e.outputTokens, 0),
    cost: sumCost(contextFiltered),
  };
  const byModel = aggregateGroup(contextFiltered, (e) => e.model);
  const byProject = aggregateGroup(contextFiltered, (e) => e.project);
  const byAgent = aggregateGroup(contextFiltered, (e) => e.agent);
  const trend = buildTrend(contextFiltered);
  const warnings = budgetWarnings(entries);
  const topModels =
    options.top !== undefined && options.top > 0 ? byModel.slice(0, options.top) : null;
  const window = periodWindow(period);
  return {
    period,
    start: window.start,
    end: window.end,
    total,
    byModel,
    byProject,
    byAgent,
    trend,
    topModels,
    budgetWarnings: warnings,
  };
}

function renderGroups(title: string, groups: ReportGroup[]): string {
  if (groups.length === 0) return `${title}: (none)`;
  const headers = ["Key", "Calls", "Input", "Output", "Cost"];
  const rows = groups.map((group) => [
    group.key,
    group.calls.toLocaleString(),
    group.inputTokens.toLocaleString(),
    group.outputTokens.toLocaleString(),
    group.cost === null ? "n/a" : `$${formatMoney(group.cost)}`,
  ]);
  const table = renderTable(headers, rows, (_row, col, text) => {
    if (col === 0) return pc.cyan(text);
    if (col === 4) return pc.green(text);
    return text;
  });
  return `${title}\n${table}`;
}

export function renderReport(result: ReportResult): string {
  const parts: string[] = [];
  parts.push(`Period: ${result.period}  (${result.start} .. ${result.end})`);
  parts.push("");
  parts.push(
    renderTable(
      ["Total calls", "Input tokens", "Output tokens", "Cost"],
      [[
        result.total.calls.toLocaleString(),
        result.total.inputTokens.toLocaleString(),
        result.total.outputTokens.toLocaleString(),
        result.total.cost === null ? "n/a" : `$${formatMoney(result.total.cost)}`,
      ]],
      (_row, col, text) => {
        if (col === 3) return pc.green(text);
        return pc.bold(text);
      },
    ),
  );
  parts.push("");
  parts.push(renderGroups("By model", result.byModel));
  parts.push("");
  parts.push(renderGroups("By project", result.byProject));
  parts.push("");
  parts.push(renderGroups("By agent", result.byAgent));
  parts.push("");
  parts.push("Trend (last 7 days)");
  parts.push(
    renderTable(
      ["Date", "Calls", "Cost"],
      result.trend.map((point) => [
        point.date,
        point.calls.toLocaleString(),
        point.cost === null ? "n/a" : `$${formatMoney(point.cost)}`,
      ]),
      (_row, col, text) => {
        if (col === 2) return pc.green(text);
        return text;
      },
    ),
  );
  if (result.topModels) {
    parts.push("");
    parts.push(`Top ${result.topModels.length} most expensive models`);
    parts.push(
      renderTable(
        ["Model", "Calls", "Cost"],
        result.topModels.map((model) => [
          model.key,
          model.calls.toLocaleString(),
          model.cost === null ? "n/a" : `$${formatMoney(model.cost)}`,
        ]),
        (_row, col, text) => {
          if (col === 0) return pc.cyan(text);
          if (col === 2) return pc.green(text);
          return text;
        },
      ),
    );
  }
  return parts.join("\n");
}

export function printReport(result: ReportResult, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  process.stdout.write(renderReport(result) + "\n");
  if (result.budgetWarnings.length > 0) {
    for (const warning of result.budgetWarnings) {
      const level = warning.percent >= 100 ? "OVER" : "WARNING";
      const color =
        warning.percent >= 100 ? pc.red(level) : pc.yellow(level);
      process.stderr.write(
        `[${color}] Budget for '${warning.project}': spent $${formatMoney(warning.spent)} of $${formatMoney(warning.monthly)} (${warning.percent >= 100 ? "over" : `${warning.percent.toFixed(1)}% of`} monthly budget).\n`,
      );
    }
  }
}

export function attachReportCommand(program: Command): void {
  program
    .command("report")
    .description("Aggregate costs from the local store")
    .option("--period <period>", "period: today, week, month or all", "week")
    .option("--project <name>", "filter by project")
    .option("--agent <name>", "filter by agent")
    .option("--top <n>", "show the top N most expensive models")
    .option("--export-client <name>", "export a billing report for a client (CSV)")
    .option("--otel-endpoint <url>", "emit cost metrics to an OpenTelemetry collector (OTLP HTTP)")
    .option("--json", "output machine-readable JSON")
    .action(async (options: {
      period?: string;
      project?: string;
      agent?: string;
      top?: string;
      exportClient?: string;
      otelEndpoint?: string;
      json?: boolean;
    }) => {
      if (options.exportClient !== undefined) {
        const entries = loadStore();
        const { buildClientExport, printClientExport, renderExportSummary } = await import("./export");
        const result = buildClientExport(options.exportClient, entries);
        printClientExport(result, options.json === true);
        if (!options.json) {
          process.stderr.write(renderExportSummary(result) + "\n");
        }
        return;
      }
      if (options.otelEndpoint !== undefined) {
        const { emitStoreMetrics } = await import("./otel");
        try {
          const sent = await emitStoreMetrics(options.otelEndpoint, loadStore(), {
            project: options.project ?? "all",
          });
          process.stdout.write(`Emitted ${sent} cost metric(s) to ${options.otelEndpoint}.\n`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`otel emit failed: ${message}\n`);
          process.exitCode = 1;
        }
        return;
      }
      const period = parseReportPeriod(options.period);
      if (period === null) {
        process.stderr.write(
          `Invalid --period value: '${options.period}'. Use today, week, month or all.\n`,
        );
        process.exitCode = 1;
        return;
      }
      const top = options.top === undefined ? undefined : parseInt(options.top, 10);
      if (top !== undefined && (!Number.isFinite(top) || top < 1)) {
        process.stderr.write(`Invalid --top value: '${options.top}'. Use a positive integer.\n`);
        process.exitCode = 1;
        return;
      }
      const result = buildReport(loadStore(), {
        period,
        project: options.project,
        agent: options.agent,
        top,
      });
      printReport(result, options.json === true);
    });
}