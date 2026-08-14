export interface ModelPricing {
  provider: string;
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface EstimateResult extends CostBreakdown {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  overridden: boolean;
}

export type UsageKind = "openai" | "anthropic";

export interface UsageRecord {
  kind: UsageKind;
  model: string;
  inputTokens: number;
  outputTokens: number;
  line: number;
}

export interface ModelAggregate {
  model: string;
  provider: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  overridden: boolean;
}

export interface TrackTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  skipped: number;
}

export interface AggregateResult {
  models: ModelAggregate[];
  total: TrackTotals;
}

export interface ModelEntry {
  name: string;
  provider: string;
  inputPerMillion: number;
  outputPerMillion: number;
  overridden: boolean;
}

export interface ResolvedPricingEntry extends ModelEntry {
  source: "override" | "builtin";
}

export interface StoreEntry {
  ts: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  project?: string;
  agent?: string;
  sessionId?: string;
}

export interface LiveCall {
  ts: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  project?: string;
  agent?: string;
  sessionId?: string;
}

export interface WatchState {
  [file: string]: { hash: string; offset: number };
}

export interface BudgetRule {
  project: string;
  monthly: number;
  updatedAt: string;
}

export type BudgetLevel = "ok" | "warning" | "over";

export interface BudgetStatus {
  project: string;
  monthly: number;
  spent: number;
  percent: number;
  level: BudgetLevel;
}

export interface BudgetWarning {
  project: string;
  monthly: number;
  spent: number;
  percent: number;
}

export interface ReportTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export interface ReportGroup {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export interface TrendPoint {
  date: string;
  calls: number;
  cost: number | null;
}

export type ReportPeriod = "today" | "week" | "month" | "all";

export interface ReportResult {
  period: ReportPeriod;
  start: string;
  end: string;
  total: ReportTotals;
  byModel: ReportGroup[];
  byProject: ReportGroup[];
  byAgent: ReportGroup[];
  trend: TrendPoint[];
  topModels: ReportGroup[] | null;
  budgetWarnings: BudgetWarning[];
}

export function formatMoney(value: number): string {
  const raw = value >= 1 ? value.toFixed(2) : value.toFixed(6);
  return raw.replace(/\.?0+$/, "");
}

export function renderTable(
  headers: string[],
  rows: string[][],
  style?: (row: number, col: number, text: string) => string,
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)),
  );
  const isNumeric = (text: string): boolean => /^-?\d+(\.\d+)?$/.test(text.trim());
  const pad = (text: string, col: number): string =>
    isNumeric(text) ? text.padStart(widths[col]) : text.padEnd(widths[col]);
  const format = (cells: string[], rowIndex: number): string =>
    cells
      .map((raw, col) => {
        const padded = pad(raw, col);
        return style ? style(rowIndex, col, padded) : padded;
      })
      .join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [format(headers, -1), sep, ...rows.map((r, i) => format(r, i))].join("\n");
}