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
  task?: string;
  kindOfCall?: "call" | "retry" | "error";
  toolCalls?: number;
  latencyMs?: number;
  contextWindow?: number;
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
  task?: string;
  kind?: "call" | "retry" | "error";
  toolCalls?: number;
  latencyMs?: number;
  contextWindow?: number;
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

export type QualityTier = "low" | "medium" | "high" | "critical";

export interface ModelQualityMeta {
  tier: QualityTier;
  speed: "fast" | "medium" | "slow";
  context: number;
  modalities: string[];
  benchmark: number;
}

export interface Session {
  id: string;
  project: string;
  limit: number;
  startedAt: string;
  endedAt?: string;
  blocked?: boolean;
}

export interface SessionStatus {
  id: string;
  project: string;
  limit: number;
  spent: number;
  percent: number;
  remaining: number;
  level: BudgetLevel;
  active: boolean;
  blocked: boolean;
}

export interface PolicyRule {
  task: string;
  quality: QualityTier;
  allow: string[];
  deny?: string[];
  updatedAt: string;
}

export interface RouteResult {
  task: string;
  taskType: string;
  requestedQuality: QualityTier;
  model: string;
  provider: string;
  tier: QualityTier;
  speed: string;
  context: number;
  blendedPricePerMillion: number;
  reason: string;
  downgraded: boolean;
  policyMatched: string | null;
}

export interface AlertConfig {
  slackWebhook?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  webhook?: string;
  enabled: boolean;
  updatedAt: string;
}

export interface AlertState {
  [key: string]: { firedAt: string };
}

export interface AlertEvent {
  name: string;
  limit: number;
  spent: number;
  percent: number;
  kind: "session" | "budget";
}

export interface OptimizeLoop {
  type: "retry-storm" | "tool-storm" | "context-pressure";
  model: string;
  count: number;
  estWaste: number;
  detail: string;
}

export interface OptimizeSuggestion {
  model: string;
  tier: QualityTier;
  calls: number;
  cost: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  suggestedModel: string;
  suggestedTier: QualityTier;
  estSaving: number;
  reasons: string[];
}

export interface OptimizeResult {
  project: string;
  suggestions: OptimizeSuggestion[];
  loops: OptimizeLoop[];
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