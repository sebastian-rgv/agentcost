import pc from "picocolors";
import { formatMoney } from "./types";
import type { StoreEntry } from "./types";

export interface CostGroup {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface ClientExport {
  client: string;
  generatedAt: string;
  total: CostGroup;
  byProject: CostGroup[];
  byAgent: CostGroup[];
  rows: Array<{
    date: string;
    project: string;
    agent: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }>;
}

export function buildClientExport(client: string, entries: StoreEntry[]): ClientExport {
  const rows = entries.map((entry) => ({
    date: entry.ts.slice(0, 10),
    project: entry.project ?? "(none)",
    agent: entry.agent ?? "(none)",
    model: entry.model,
    calls: 1,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cost: entry.cost ?? 0,
  }));
  const total: CostGroup = {
    key: client,
    calls: entries.length,
    inputTokens: entries.reduce((sum, e) => sum + e.inputTokens, 0),
    outputTokens: entries.reduce((sum, e) => sum + e.outputTokens, 0),
    cost: entries.reduce((sum, e) => sum + (e.cost ?? 0), 0),
  };
  const byProject = groupTotals(entries, (e) => e.project);
  const byAgent = groupTotals(entries, (e) => e.agent);
  return { client, generatedAt: new Date().toISOString(), total, byProject, byAgent, rows };
}

function groupTotals(
  entries: StoreEntry[],
  keyOf: (entry: StoreEntry) => string | undefined,
): CostGroup[] {
  interface Accumulator {
    key: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }
  const groups = new Map<string, Accumulator>();
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
    group.cost += entry.cost ?? 0;
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.cost - a.cost || a.key.localeCompare(b.key),
  );
}

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function renderClientExportCsv(exportData: ClientExport): string {
  const lines: string[] = [];
  lines.push("agentcost client export");
  lines.push(`Client,${csvCell(exportData.client)}`);
  lines.push(`Generated,${csvCell(exportData.generatedAt)}`);
  lines.push(
    `Total calls,${exportData.total.calls},Total cost,$${formatMoney(exportData.total.cost)}`,
  );
  lines.push("");
  lines.push("By project");
  lines.push("Project,Calls,Cost");
  for (const group of exportData.byProject) {
    lines.push(`${csvCell(group.key)},${group.calls},$${formatMoney(group.cost)}`);
  }
  lines.push("");
  lines.push("By agent");
  lines.push("Agent,Calls,Cost");
  for (const group of exportData.byAgent) {
    lines.push(`${csvCell(group.key)},${group.calls},$${formatMoney(group.cost)}`);
  }
  lines.push("");
  lines.push("Line items");
  lines.push("Date,Project,Agent,Model,Calls,Input,Output,Cost");
  for (const row of exportData.rows) {
    lines.push(
      [
        csvCell(row.date),
        csvCell(row.project),
        csvCell(row.agent),
        csvCell(row.model),
        row.calls,
        row.inputTokens,
        row.outputTokens,
        `$${formatMoney(row.cost)}`,
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function printClientExport(exportData: ClientExport, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(exportData) + "\n");
    return;
  }
  process.stdout.write(renderClientExportCsv(exportData) + "\n");
}

export function renderExportSummary(exportData: ClientExport): string {
  return pc.green(
    `Export for client '${exportData.client}': ${exportData.total.calls} calls, $${formatMoney(exportData.total.cost)} total.`,
  );
}