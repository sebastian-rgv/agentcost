import pc from "picocolors";
import type { Command } from "commander";
import { scanCallsInDir, entryFromCall, loadWatchState, saveWatchState } from "./watch";
import { formatLiveCall } from "./watch";
import { appendStore } from "./store";
import { formatMoney, renderTable } from "./types";
import type { LiveCall } from "./types";

export interface LiveSummary {
  calls: number;
  cost: number | null;
  inputTokens: number;
  outputTokens: number;
  byModel: { key: string; calls: number; cost: number | null }[];
  callsPerMinute: number;
  elapsedSeconds: number;
  topAgent: { key: string; calls: number; cost: number | null } | null;
  topProject: { key: string; calls: number; cost: number | null } | null;
}

function sumCost(calls: LiveCall[]): number | null {
  let total = 0;
  let hasUnknown = false;
  for (const call of calls) {
    if (call.cost === null) hasUnknown = true;
    else total += call.cost;
  }
  return hasUnknown ? null : total;
}

interface GroupAccumulator {
  key: string;
  calls: number;
  cost: number;
}

function groupBy(calls: LiveCall[], keyOf: (call: LiveCall) => string | undefined) {
  const groups = new Map<string, GroupAccumulator>();
  for (const call of calls) {
    const key = keyOf(call);
    if (key === undefined) continue;
    const group = groups.get(key) ?? { key, calls: 0, cost: 0 };
    group.calls += 1;
    if (call.cost !== null) group.cost += call.cost;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ key: group.key, calls: group.calls, cost: group.cost }))
    .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || a.key.localeCompare(b.key));
}

export function buildLiveSummary(calls: LiveCall[]): LiveSummary {
  const byModel = groupBy(calls, (call) => call.model);
  const agents = groupBy(calls, (call) => call.agent);
  const projects = groupBy(calls, (call) => call.project);
  let elapsedSeconds = 0;
  if (calls.length > 0) {
    const first = Math.min(...calls.map((call) => Date.parse(call.ts)));
    const last = Math.max(...calls.map((call) => Date.parse(call.ts)));
    elapsedSeconds = Math.max(0, (last - first) / 1000);
  }
  const minutes = elapsedSeconds / 60;
  return {
    calls: calls.length,
    cost: sumCost(calls),
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
    byModel,
    callsPerMinute: minutes > 0 ? calls.length / minutes : 0,
    elapsedSeconds,
    topAgent: agents[0] ?? null,
    topProject: projects[0] ?? null,
  };
}

export function renderLiveDashboard(summary: LiveSummary): string {
  const lines: string[] = [];
  lines.push(`agentcost live — ${new Date().toLocaleTimeString()}`);
  lines.push("");
  lines.push(
    renderTable(
      ["Total", "Calls", "Input", "Output", "Cost"],
      [[
        "Total",
        summary.calls.toLocaleString(),
        summary.inputTokens.toLocaleString(),
        summary.outputTokens.toLocaleString(),
        summary.cost === null ? "n/a" : `$${formatMoney(summary.cost)}`,
      ]],
      (_row, col, text) => {
        if (col === 4) return pc.green(text);
        return pc.bold(text);
      },
    ),
  );
  lines.push("");
  lines.push(`Per minute: ${summary.callsPerMinute.toFixed(2)} calls/min`);
  if (summary.topAgent) {
    lines.push(`Top agent: ${summary.topAgent.key} (${summary.topAgent.calls} calls, $${formatMoney(summary.topAgent.cost ?? 0)})`);
  }
  if (summary.topProject) {
    lines.push(`Top project: ${summary.topProject.key} (${summary.topProject.calls} calls, $${formatMoney(summary.topProject.cost ?? 0)})`);
  }
  lines.push("");
  lines.push("By model");
  if (summary.byModel.length === 0) {
    lines.push("(none yet)");
  } else {
    lines.push(
      renderTable(
        ["Model", "Calls", "Cost"],
        summary.byModel.map((model) => [
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
  return lines.join("\n");
}

export async function runLive(options: { dir: string; save: boolean }): Promise<void> {
  const calls: LiveCall[] = [];
  let state = loadWatchState();
  let stop = false;
  const onSigint = (): void => {
    stop = true;
  };
  process.on("SIGINT", onSigint);
  process.stdout.write(`agentcost live — watching ${options.dir} (Ctrl+C to stop).\n`);
  while (!stop) {
    const { calls: fresh, nextState } = scanCallsInDir(options.dir, state);
    state = nextState;
    for (const call of fresh) {
      calls.push(call);
      process.stdout.write(formatLiveCall(call) + "\n");
      if (options.save) appendStore(entryFromCall(call));
    }
    saveWatchState(state);
    if (!stop) await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  process.removeListener("SIGINT", onSigint);
  process.stdout.write("\n");
  process.stdout.write(renderLiveDashboard(buildLiveSummary(calls)) + "\n");
}

export function attachLiveCommand(program: Command): void {
  program
    .command("live")
    .description("Live dashboard of usage logs in a directory (refreshes every 2s)")
    .option("--dir <dir>", "directory to watch (default: current directory)")
    .option("--save", "save captured calls to the local store")
    .action(async (options: { dir?: string; save?: boolean }) => {
      const dir = options.dir ?? process.cwd();
      if (!process.stdout.isTTY) {
        const { runWatch } = await import("./watch");
        await runWatch({ dir, intervalMs: 2000, save: options.save === true });
        return;
      }
      await runLive({ dir, save: options.save === true });
    });
}