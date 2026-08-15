import { readFileSync } from "node:fs";
import pc from "picocolors";
import type { Command } from "commander";
import { resolveModel } from "./pricing";
import { formatMoney, renderTable } from "./types";
import { appendStore } from "./store";
import { parseLogFormat } from "./format";
import type { LogFormat } from "./format";
import type {
  AggregateResult,
  ModelAggregate,
  StoreEntry,
  TrackTotals,
  UsageKind,
  UsageRecord,
} from "./types";

interface FoundTokens {
  input: number;
  output: number;
  kind: UsageKind;
}

function pickTokens(container: Record<string, unknown>): FoundTokens | null {
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(container, key);
  if (has("prompt_tokens") || has("completion_tokens")) {
    return {
      input: num(container.prompt_tokens) ?? 0,
      output: num(container.completion_tokens) ?? 0,
      kind: "openai",
    };
  }
  if (has("input_tokens") || has("output_tokens")) {
    return {
      input: num(container.input_tokens) ?? 0,
      output: num(container.output_tokens) ?? 0,
      kind: "anthropic",
    };
  }
  if (has("promptTokens") || has("completionTokens")) {
    return {
      input: num(container.promptTokens) ?? 0,
      output: num(container.completionTokens) ?? 0,
      kind: "openai",
    };
  }
  if (has("inputTokens") || has("outputTokens")) {
    return {
      input: num(container.inputTokens) ?? 0,
      output: num(container.outputTokens) ?? 0,
      kind: "anthropic",
    };
  }
  return null;
}

export function parseUsageLine(rec: unknown, line: number): UsageRecord | null {
  if (typeof rec !== "object" || rec === null) return null;
  const obj = rec as Record<string, unknown>;
  const model = typeof obj.model === "string" ? obj.model : null;
  if (!model) return null;
  const usage = obj.usage;
  let found: FoundTokens | null = null;
  if (typeof usage === "object" && usage !== null) {
    found = pickTokens(usage as Record<string, unknown>);
  }
  if (!found) {
    found = pickTokens(obj);
  }
  if (!found) return null;
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const str = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;
  const kindValue = str(obj.kind) ?? str(obj.status);
  const kindOfCall: UsageRecord["kindOfCall"] =
    kindValue === "retry" || kindValue === "error" ? kindValue : undefined;
  return {
    kind: found.kind,
    model,
    inputTokens: found.input,
    outputTokens: found.output,
    line,
    task: str(obj.task),
    kindOfCall,
    toolCalls: num(obj.toolCalls) ?? num(obj.tool_calls) ?? undefined,
    latencyMs: num(obj.latencyMs) ?? num(obj.latency_ms) ?? undefined,
    contextWindow: num(obj.contextWindow) ?? num(obj.context_window) ?? undefined,
  };
}

export function parseUsageLineWithFormat(
  rec: unknown,
  line: number,
  format: LogFormat,
): UsageRecord | null {
  const parsed = parseUsageLine(rec, line);
  if (!parsed) return null;
  if (format === "openai" && parsed.kind !== "openai") return null;
  if (format === "anthropic" && parsed.kind !== "anthropic") return null;
  return parsed;
}

export function trackJsonl(text: string, format: LogFormat = "auto"): AggregateResult {
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
    const parsed = parseUsageLineWithFormat(rec, i + 1, format);
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
      provider: "unknown",
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: null,
      overridden: false,
    };
    entry.calls += 1;
    entry.inputTokens += record.inputTokens;
    entry.outputTokens += record.outputTokens;
    byModel.set(record.model, entry);
  }

  const models = [...byModel.values()].map((entry) => {
    const resolved = resolveModel(entry.model);
    if (!resolved) return { ...entry };
    const pricing = resolved.pricing;
    return {
      ...entry,
      provider: pricing.provider,
      overridden: resolved.overridden,
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
    m.overridden ? `${m.model}*` : m.model,
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

export function markOverridden(result: AggregateResult): boolean {
  return result.models.some((model) => model.overridden);
}

export function printTrack(result: AggregateResult, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  process.stdout.write(renderTrackTable(result) + "\n");
  if (markOverridden(result)) {
    process.stderr.write("* cost from local price overrides\n");
  }
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

export function entryFromRecord(
  record: UsageRecord,
  context?: { project?: string; agent?: string; sessionId?: string },
): StoreEntry {
  const resolved = resolveModel(record.model);
  const cost = resolved
    ? (record.inputTokens / 1_000_000) * resolved.pricing.inputPerMillion +
      (record.outputTokens / 1_000_000) * resolved.pricing.outputPerMillion
    : null;
  return {
    ts: new Date().toISOString(),
    model: record.model,
    provider: resolved?.pricing.provider ?? "unknown",
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cost,
    project: context?.project,
    agent: context?.agent,
    sessionId: context?.sessionId,
    task: record.task,
    kind: record.kindOfCall,
    toolCalls: record.toolCalls,
    latencyMs: record.latencyMs,
    contextWindow: record.contextWindow,
  };
}

export function trackFile(
  file: string,
  format: LogFormat,
): AggregateResult {
  const text = readFileSync(file, "utf8");
  return trackJsonl(text, format);
}

export function attachTrackCommand(program: Command): void {
  program
    .command("track")
    .description("Parse a usage log (.jsonl/.ndjson/.log) and report costs per model")
    .argument("<file>", "path to the usage log")
    .option("--format <format>", "log format: auto, openai or anthropic", "auto")
    .option("--save", "save parsed calls to the local store")
    .option("--project <name>", "tag saved entries with a project name")
    .option("--agent <name>", "tag saved entries with an agent name")
    .option("--session <id>", "tag saved entries with a session id")
    .option("--json", "output machine-readable JSON")
    .action(async (file: string, options: {
      format?: string;
      save?: boolean;
      project?: string;
      agent?: string;
      session?: string;
      json?: boolean;
    }) => {
      const format = parseLogFormat(options.format);
      if (format === null) {
        process.stderr.write(`Invalid --format value: '${options.format}'. Use auto, openai or anthropic.\n`);
        process.exitCode = 1;
        return;
      }
      let result: AggregateResult;
      try {
        result = trackFile(file, format);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Cannot read '${file}': ${message}\n`);
        process.exitCode = 1;
        return;
      }
      if (options.save) {
        if (options.session !== undefined) {
          const { findSession } = await import("./session");
          const session = findSession(options.session);
          if (!session) {
            process.stderr.write(
              `Session '${options.session}' not found. Start one with 'agentcost session start'.\n`,
            );
            process.exitCode = 1;
            return;
          }
          if (session.blocked) {
            process.stderr.write(
              `Session '${options.session}' is blocked by the kill switch. Reset it with 'agentcost session reset --id ${options.session}'.\n`,
            );
            process.exitCode = 1;
            return;
          }
        }
        const lines = readFileSync(file, "utf8").split("\n");
        let saved = 0;
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].trim().length === 0) continue;
          let rec: unknown;
          try {
            rec = JSON.parse(lines[i]);
          } catch {
            continue;
          }
          const record = parseUsageLineWithFormat(rec, i + 1, format);
          if (record) {
            appendStore(entryFromRecord(record, {
              project: options.project,
              agent: options.agent,
              sessionId: options.session,
            }));
            saved += 1;
          }
        }
        if (!options.json) {
          process.stderr.write(`Saved ${saved} call(s) to the local store.\n`);
        }
      }
      printTrack(result, options.json === true);
    });
}