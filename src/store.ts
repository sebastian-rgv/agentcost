import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import type { AlertConfig, AlertState, BudgetRule, PolicyRule, Session, StoreEntry } from "./types";

export function agentcostHome(): string {
  const override = process.env.AGENTCOST_HOME;
  return resolve(override && override.length > 0 ? override : join(homedir(), ".agentcost"));
}

export function storePath(): string {
  return join(agentcostHome(), "store.jsonl");
}

export function budgetPath(): string {
  return join(agentcostHome(), "budget.json");
}

export function pricingOverridesPath(): string {
  return join(agentcostHome(), "pricing.json");
}

export function watchStatePath(): string {
  return join(agentcostHome(), "watch-state.json");
}

export function sessionsPath(): string {
  return join(agentcostHome(), "sessions.json");
}

export function policyPath(): string {
  return join(agentcostHome(), "policy.json");
}

export function alertsPath(): string {
  return join(agentcostHome(), "alerts.json");
}

export function alertsStatePath(): string {
  return join(agentcostHome(), "alerts-state.json");
}

function readJsonFile<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object") return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(file: string, value: unknown): void {
  const dir = agentcostHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function loadSessions(): Session[] {
  return readJsonFile<Session[]>(sessionsPath(), []);
}

export function saveSessions(sessions: Session[]): void {
  writeJsonFile(sessionsPath(), sessions);
}

export function loadPolicies(): PolicyRule[] {
  return readJsonFile<PolicyRule[]>(policyPath(), []);
}

export function savePolicies(policies: PolicyRule[]): void {
  writeJsonFile(policyPath(), policies);
}

export function loadAlertConfig(): AlertConfig | null {
  const config = readJsonFile<AlertConfig | null>(alertsPath(), null);
  if (config === null) return null;
  return {
    ...config,
    enabled: config.enabled ?? true,
    updatedAt: config.updatedAt ?? new Date().toISOString(),
  };
}

export function saveAlertConfig(config: AlertConfig): void {
  writeJsonFile(alertsPath(), config);
}

export function loadAlertState(): AlertState {
  return readJsonFile<AlertState>(alertsStatePath(), {});
}

export function saveAlertState(state: AlertState): void {
  writeJsonFile(alertsStatePath(), state);
}

export function loadStore(): StoreEntry[] {
  const file = storePath();
  if (!existsSync(file)) return [];
  const entries: StoreEntry[] = [];
  const text = readFileSync(file, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as StoreEntry;
      entries.push(parsed);
    } catch {
      // ignore malformed lines in the store
    }
  }
  return entries;
}

export function appendStore(entry: StoreEntry): void {
  const dir = agentcostHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(storePath(), JSON.stringify(entry) + "\n", "utf8");
}

export function loadBudgets(): Record<string, BudgetRule> {
  const file = budgetPath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const result: Record<string, BudgetRule> = {};
    for (const [project, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null) continue;
      const obj = value as Record<string, unknown>;
      const monthly = typeof obj.monthly === "number" && Number.isFinite(obj.monthly) ? obj.monthly : null;
      if (monthly === null || monthly < 0) continue;
      result[project] = {
        project,
        monthly,
        updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function saveBudgets(budgets: Record<string, BudgetRule>): void {
  const dir = agentcostHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const serializable: Record<string, { monthly: number; updatedAt: string }> = {};
  for (const [project, rule] of Object.entries(budgets)) {
    serializable[project] = { monthly: rule.monthly, updatedAt: rule.updatedAt };
  }
  writeFileSync(budgetPath(), JSON.stringify(serializable, null, 2) + "\n", "utf8");
}

export function listUsageFiles(dir: string): string[] {
  const results: string[] = [];
  walkForLogs(dir, results);
  return results.sort();
}

function walkForLogs(dir: string, out: string[]): void {
  let items;
  try {
    items = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      walkForLogs(full, out);
    } else if (isLogFile(item.name)) {
      out.push(full);
    }
  }
}

export function isLogFile(name: string): boolean {
  return /\.(jsonl|ndjson|log)$/i.test(name);
}