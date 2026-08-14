import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import type { Command } from "commander";
import { resolveModel } from "./pricing";
import { parseUsageLine } from "./track";
import { appendStore, listUsageFiles, watchStatePath } from "./store";
import { formatMoney } from "./types";
import type { LiveCall, StoreEntry, UsageRecord, WatchState } from "./types";

export function loadWatchState(): WatchState {
  const file = watchStatePath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as WatchState;
  } catch {
    return {};
  }
}

export function saveWatchState(state: WatchState): void {
  const dir = resolve(watchStatePath(), "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(watchStatePath(), JSON.stringify(state, null, 2) + "\n", "utf8");
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function extractTs(obj: Record<string, unknown>): string | undefined {
  const value = obj.ts ?? obj.timestamp ?? obj.created ?? obj.createdAt;
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isNaN(time) ? undefined : new Date(time).toISOString();
  }
  if (typeof value === "number" && value > 0) {
    const isSeconds = value < 1e12;
    return new Date(isSeconds ? value * 1000 : value).toISOString();
  }
  return undefined;
}

export function liveCallFromRecord(record: UsageRecord, raw?: unknown): LiveCall {
  let ts: string | undefined;
  if (typeof raw === "object" && raw !== null) {
    ts = extractTs(raw as Record<string, unknown>);
  }
  const resolved = resolveModel(record.model);
  const cost = resolved
    ? (record.inputTokens / 1_000_000) * resolved.pricing.inputPerMillion +
      (record.outputTokens / 1_000_000) * resolved.pricing.outputPerMillion
    : null;
  return {
    ts: ts ?? new Date().toISOString(),
    model: record.model,
    provider: resolved?.pricing.provider ?? "unknown",
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cost,
  };
}

export function entryFromCall(call: LiveCall): StoreEntry {
  return {
    ts: call.ts,
    model: call.model,
    provider: call.provider,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    cost: call.cost,
    project: call.project,
    agent: call.agent,
    sessionId: call.sessionId,
  };
}

export function scanCallsInDir(dir: string, prior: WatchState = {}): {
  calls: LiveCall[];
  nextState: WatchState;
} {
  const nextState: WatchState = { ...prior };
  const calls: LiveCall[] = [];
  for (const file of listUsageFiles(dir)) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const hash = hashContent(content);
    const known = prior[file];
    if (known && known.hash === hash) {
      nextState[file] = known;
      continue;
    }
    const offset = known ? known.offset : 0;
    const start = offset >= 0 && offset < content.length ? offset : 0;
    const slice = content.slice(start);
    const lines = slice.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i].trim();
      if (raw.length === 0) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(raw);
      } catch {
        continue;
      }
      const record = parseUsageLine(obj, i + 1);
      if (record) calls.push(liveCallFromRecord(record, obj));
    }
    nextState[file] = { hash, offset: content.length };
  }
  return { calls, nextState };
}

export function formatLiveCall(call: LiveCall): string {
  const time = call.ts.length >= 19 ? call.ts.slice(11, 19) : call.ts;
  const rawCost = call.cost;
  let costText: string;
  if (rawCost === null) {
    costText = pc.dim("n/a");
  } else if (rawCost < 0.01) {
    costText = pc.green(`$${formatMoney(rawCost)}`);
  } else if (rawCost < 0.1) {
    costText = pc.yellow(`$${formatMoney(rawCost)}`);
  } else {
    costText = pc.red(`$${formatMoney(rawCost)}`);
  }
  return `${pc.dim(time)}  ${pc.cyan(call.model)}  in=${call.inputTokens} out=${call.outputTokens}  ${costText}`;
}

export function parseIntervalMs(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^(\d+)(ms|s|m)?$/);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unit = match[2] ?? "ms";
  const factor = unit === "s" ? 1000 : unit === "m" ? 60000 : 1;
  return amount * factor;
}

export async function runWatch(options: {
  dir: string;
  intervalMs: number;
  save: boolean;
}): Promise<void> {
  let state = loadWatchState();
  let captured = 0;
  let stop = false;
  const onSigint = (): void => {
    stop = true;
  };
  process.on("SIGINT", onSigint);
  process.stdout.write(
    `Watching ${options.dir} every ${options.intervalMs}ms for usage logs (Ctrl+C to stop).\n`,
  );
  while (!stop) {
    const { calls, nextState } = scanCallsInDir(options.dir, state);
    state = nextState;
    for (const call of calls) {
      captured += 1;
      process.stdout.write(formatLiveCall(call) + "\n");
      if (options.save) appendStore(entryFromCall(call));
    }
    saveWatchState(state);
    if (!stop) await new Promise((resolvePromise) => setTimeout(resolvePromise, options.intervalMs));
  }
  process.removeListener("SIGINT", onSigint);
  process.stdout.write(`\nwatch stopped, ${captured} calls captured\n`);
}

export function attachWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch a directory for usage logs and print calls live")
    .option("--dir <dir>", "directory to watch (default: current directory)")
    .option("--interval <interval>", "poll interval, e.g. 5s or 2000ms", "5s")
    .option("--save", "save captured calls to the local store")
    .action(async (options: { dir?: string; interval?: string; save?: boolean }) => {
      const dir = options.dir ?? process.cwd();
      const intervalMs = parseIntervalMs(options.interval ?? "5s");
      if (intervalMs === null) {
        process.stderr.write(
          `Invalid --interval value: '${options.interval}'. Use e.g. 5s or 2000ms.\n`,
        );
        process.exitCode = 1;
        return;
      }
      await runWatch({ dir, intervalMs, save: options.save === true });
    });
}