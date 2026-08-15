import pc from "picocolors";
import type { Command } from "commander";
import { allPricingEntries } from "./pricing";
import { loadStore } from "./store";
import { qualityMeta, tierRank } from "./quality";
import { formatMoney } from "./types";
import type {
  OptimizeLoop,
  OptimizeResult,
  OptimizeSuggestion,
  QualityTier,
  StoreEntry,
} from "./types";

interface ModelStats {
  model: string;
  calls: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  retries: number;
  toolStormCalls: number;
  contextPressureCalls: number;
}

const STORM_WINDOW_MS = 60_000;
const STORM_THRESHOLD = 6;
const CONTEXT_PRESSURE_RATIO = 0.8;

function entriesForProject(entries: StoreEntry[], project: string): StoreEntry[] {
  return entries.filter((entry) => entry.project === project);
}

export function detectLoops(entries: StoreEntry[], project: string): OptimizeLoop[] {
  const pool = entriesForProject(entries, project).sort((a, b) => a.ts.localeCompare(b.ts));
  const loops: OptimizeLoop[] = [];
  const byModel = new Map<string, StoreEntry[]>();
  for (const entry of pool) {
    const bucket = byModel.get(entry.model) ?? [];
    bucket.push(entry);
    byModel.set(entry.model, bucket);
  }

  for (const [model, calls] of byModel) {
    const modelCost = calls.reduce((sum, call) => sum + (call.cost ?? 0), 0);

    const retryCount = calls.filter((call) => call.kind === "retry" || call.kind === "error").length;
    if (retryCount >= 3) {
      const estWaste = calls
        .filter((call) => call.kind === "retry" || call.kind === "error")
        .reduce((sum, call) => sum + (call.cost ?? 0), 0);
      loops.push({
        type: "retry-storm",
        model,
        count: retryCount,
        estWaste,
        detail: `${retryCount} retry/error call(s) recorded for '${model}'`,
      });
    }

    let stormCalls = 0;
    for (let i = 0; i < calls.length; i += 1) {
      let windowCount = 1;
      const anchor = Date.parse(calls[i].ts);
      for (let j = i + 1; j < calls.length; j += 1) {
        const diff = Date.parse(calls[j].ts) - anchor;
        if (diff > STORM_WINDOW_MS) break;
        windowCount += 1;
      }
      if (windowCount > STORM_THRESHOLD) {
        stormCalls += windowCount;
        i += windowCount - 1;
      }
    }
    if (stormCalls >= STORM_THRESHOLD) {
      const estWaste = modelCost;
      loops.push({
        type: "tool-storm",
        model,
        count: stormCalls,
        estWaste,
        detail: `${stormCalls} calls to '${model}' within a rolling ${STORM_WINDOW_MS / 1000}s window (possible tool-call storm)`,
      });
    }

    const pressureCalls = calls.filter((call) => {
      if (call.contextWindow === undefined || call.contextWindow <= 0) return false;
      return call.inputTokens / call.contextWindow >= CONTEXT_PRESSURE_RATIO;
    }).length;
    if (pressureCalls >= 3) {
      loops.push({
        type: "context-pressure",
        model,
        count: pressureCalls,
        estWaste: modelCost,
        detail: `${pressureCalls} calls to '${model}' used >= ${Math.round(CONTEXT_PRESSURE_RATIO * 100)}% of context window`,
      });
    }
  }
  return loops;
}

function suggestForModel(stats: ModelStats): OptimizeSuggestion | null {
  const current = qualityMeta(stats.model);
  if (!current) return null;
  const avgInput = stats.inputTokens / stats.calls;
  const avgOutput = stats.outputTokens / stats.calls;
  const catalog = allPricingEntries().filter((entry) => {
    const meta = qualityMeta(entry.name);
    if (!meta) return false;
    return tierRank(meta.tier) <= tierRank(current.tier);
  });
  const cheapest = catalog.sort((a, b) => {
    const priceA = (a.inputPerMillion + a.outputPerMillion) / 2;
    const priceB = (b.inputPerMillion + b.outputPerMillion) / 2;
    return priceA - priceB || a.name.localeCompare(b.name);
  })[0];
  if (!cheapest || cheapest.name === stats.model) return null;
  const meta = qualityMeta(cheapest.name)!;
  const newCost = (avgInput / 1_000_000) * cheapest.inputPerMillion +
    (avgOutput / 1_000_000) * cheapest.outputPerMillion;
  const oldCost = stats.cost / stats.calls;
  const estSaving = Math.max(0, (oldCost - newCost) * stats.calls);
  if (estSaving <= 0) return null;
  const reasons: string[] = [];
  reasons.push(
    `'${stats.model}' (tier ${current.tier}) cost $${formatMoney(oldCost)}/call avg`,
  );
  reasons.push(
    `'${cheapest.name}' (tier ${meta.tier}) costs ~$${formatMoney(newCost)}/call avg`,
  );
  if (stats.retries > 0) {
    reasons.push(`${stats.retries} retry/error call(s) suggest stability issues`);
  }
  if (stats.contextPressureCalls > 0) {
    reasons.push(`${stats.contextPressureCalls} call(s) near context limit`);
  }
  return {
    model: stats.model,
    tier: current.tier,
    calls: stats.calls,
    cost: stats.cost,
    avgInputTokens: Math.round(avgInput),
    avgOutputTokens: Math.round(avgOutput),
    suggestedModel: cheapest.name,
    suggestedTier: meta.tier as QualityTier,
    estSaving,
    reasons,
  };
}

export function optimizeProject(project: string): OptimizeResult {
  const entries = entriesForProject(loadStore(), project);
  const byModel = new Map<string, ModelStats>();
  for (const entry of entries) {
    const stats = byModel.get(entry.model) ?? {
      model: entry.model,
      calls: 0,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      retries: 0,
      toolStormCalls: 0,
      contextPressureCalls: 0,
    };
    stats.calls += 1;
    stats.cost += entry.cost ?? 0;
    stats.inputTokens += entry.inputTokens;
    stats.outputTokens += entry.outputTokens;
    if (entry.kind === "retry" || entry.kind === "error") stats.retries += 1;
    byModel.set(entry.model, stats);
  }
  const loops = detectLoops(entries, project);
  const suggestions = [...byModel.values()]
    .filter((stats) => stats.calls >= 3)
    .map((stats) => suggestForModel(stats))
    .filter((suggestion): suggestion is OptimizeSuggestion => suggestion !== null)
    .sort((a, b) => b.estSaving - a.estSaving);
  return { project, suggestions, loops };
}

export function renderOptimize(result: OptimizeResult): string {
  const parts: string[] = [];
  parts.push(`Optimization analysis for project '${result.project}'`);
  parts.push("");
  if (result.loops.length === 0) {
    parts.push("No expensive loops detected.");
  } else {
    parts.push("Expensive loops");
    for (const loop of result.loops) {
      const cost = loop.estWaste > 0 ? ` (waste ~$${formatMoney(loop.estWaste)})` : "";
      parts.push(`  [${pc.yellow(loop.type)}] ${loop.detail}${cost}`);
    }
  }
  parts.push("");
  if (result.suggestions.length === 0) {
    parts.push("No model switches suggested (already optimal or not enough data).");
  } else {
    parts.push("Suggested model changes (based on real store data)");
    for (const suggestion of result.suggestions) {
      parts.push(
        `  ${pc.cyan(suggestion.model)} (${suggestion.tier}) -> ${pc.green(suggestion.suggestedModel)} (${suggestion.suggestedTier})`,
      );
      parts.push(
        `    ${suggestion.calls} calls, $${formatMoney(suggestion.cost)} spent, est. saving $${formatMoney(suggestion.estSaving)}`,
      );
      for (const reason of suggestion.reasons) {
        parts.push(`    - ${reason}`);
      }
    }
  }
  return parts.join("\n");
}

export function attachOptimizeCommand(program: Command): void {
  program
    .command("optimize")
    .description("Analyze the store and suggest model changes per project from real data")
    .requiredOption("--project <name>", "project name")
    .option("--json", "output machine-readable JSON")
    .action((options: { project: string; json?: boolean }) => {
      const result = optimizeProject(options.project);
      if (options.json) {
        process.stdout.write(JSON.stringify(result) + "\n");
      } else {
        process.stdout.write(renderOptimize(result) + "\n");
      }
    });
}