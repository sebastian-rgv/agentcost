import { readFileSync } from "node:fs";
import pc from "picocolors";
import type { Command } from "commander";
import { findModel } from "./pricing";
import { formatMoney, renderTable } from "./types";
import type {
  AggregateResult,
  ModelAggregate,
  TrackTotals,
  UsageRecord,
} from "./types";

export function parseUsageLine(rec: unknown, line: number): UsageRecord | null {
  if (typeof rec !== "object" || rec === null) return null;
  const obj = rec as Record<string, unknown>;
  const model = typeof obj.model === "string" ? obj.model : null;
  if (!model) return null;
  const usage = obj.usage;
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as Record<string, unknown>;
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  if (Object.prototype.hasOwnProperty.call(u, "prompt_tokens") ||
      Object.prototype.hasOwnProperty.call(u, "completion_tokens")) {
    return {
      kind: "openai",
      model,
      inputTokens: num(u.prompt_tokens) ?? 0,
      outputTokens: num(u.completion_tokens) ?? 0,
      line,
    };
  }
  if (Object.prototype.hasOwnProperty.call(u, "input_tokens") ||
      Object.prototype.hasOwnProperty.call(u, "output_tokens")) {
    return {
      kind: "anthropic",
      model,
      inputTokens: num(u.input_tokens) ?? 0,
      outputTokens: num(u.output_tokens) ?? 0,
      line,
    };
  }
  return null;
}

export function trackJsonl(text: string): AggregateResult {
  const records: UsageRecord[] = [];
  let skipped = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (raw.length === 0) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(raw);
    } catch {
      skipped += 1;
      continue;
    }
    const parsed = parseUsageLine(rec, i + 1);
    if (parsed) {
      records.push(parsed);
    } else {
      skipped += 1;
    }
  }
  return aggregate(records, skipped);
}

export function aggregate(records: UsageRecord[], skipped = 0): AggregateResult {
  const byModel = new Map<string, ModelAggregate>();
  for (const record of records) {
    const entry = byModel.get(record.model) ?? {
      model: record.model,
      provider: findModel(record.model)?.provider ?? "unknown",
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: null,
    };
    entry.calls += 1;
    entry.inputTokens += record.inputTokens;
    entry.outputTokens += record.outputTokens;
    byModel.set(record.model, entry);
  }

  const models = [...byModel.values()].map((entry) => {
    const pricing = findModel(entry.model);
    if (!pricing) return { ...entry, cost: null };
    return {
      ...entry,
      cost:
        (entry.inputTokens / 1_000_000) * pricing.inputPerMillion +
        (entry.outputTokens / 1_000_000) * pricing.outputPerMillion,
    };
  });

  models.sort((a, b) => {
    const costA = a.cost ?? -1;
    const costB = b.cost ?? -1;
    return costB - costA || a.model.localeCompare(b.model);
  });

  const total: TrackTotals = {
    calls: models.reduce((sum, m) => sum + m.calls, 0),
    inputTokens: models.reduce((sum, m) => sum + m.inputTokens, 0),
    outputTokens: models.reduce((sum, m) => sum + m.outputTokens, 0),
    cost: models.reduce<number | null>((sum, m) => {
      if (sum === null || m.cost === null) return null;
      return sum + m.cost;
    }, 0),
    skipped,
  };

  return { models, total };
}

export function renderTrackTable(result: AggregateResult): string {
  const headers = ["Model", "Calls", "Input", "Output", "Cost"];
  const rows = result.models.map((m) => [
    m.model,
    m.calls.toLocaleString(),
    m.inputTokens.toLocaleString(),
    m.outputTokens.toLocaleString(),
    m.cost === null ? "n/a" : `$${formatMoney(m.cost)}`,
  ]);
  rows.push([
    "Total",
    result.total.calls.toLocaleString(),
    result.total.inputTokens.toLocaleString(),
    result.total.outputTokens.toLocaleString(),
    result.total.cost === null ? "n/a" : `$${formatMoney(result.total.cost)}`,
  ]);
  return renderTable(
    headers,
    rows,
    (row, col, text) => {
      if (row === rows.length - 1) return pc.bold(text);
      if (col === 0) return pc.cyan(text);
      if (col === 4) return pc.green(text);
      return text;
    },
  );
}

export function printTrack(result: AggregateResult, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  process.stdout.write(renderTrackTable(result) + "\n");
  if (result.total.skipped > 0) {
    process.stderr.write(
      `Warning: skipped ${result.total.skipped} line(s) that could not be parsed.\n`,
    );
  }
  const unknown = result.models.filter((m) => m.cost === null);
  if (unknown.length > 0) {
    process.stderr.write(
      `Warning: cost unknown for: ${unknown.map((m) => m.model).join(", ")}.\n`,
    );
  }
}

export function attachTrackCommand(program: Command): void {
  program
    .command("track")
    .description("Parse a JSONL usage log and report costs per model")
    .argument("<file>", "path to the JSONL usage log")
    .option("--json", "output machine-readable JSON")
    .action((file: string, options: { json?: boolean }) => {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Cannot read '${file}': ${message}\n`);
        process.exitCode = 1;
        return;
      }
      printTrack(trackJsonl(text), options.json === true);
    });
}