import pc from "picocolors";
import type { Command } from "commander";
import { allPricingEntries } from "./pricing";
import { loadPolicies, loadSessions, loadStore, savePolicies } from "./store";
import { downgradeTier, qualityMeta, tierRank, validQuality } from "./quality";
import { sessionStatus } from "./session";
import { renderTable } from "./types";
import type { PolicyRule, QualityTier, RouteResult } from "./types";

export interface RouteOptions {
  maxCost?: number;
  sessionId?: string;
  project?: string;
}

export const TASK_TYPES = [
  "coding",
  "writing",
  "planning",
  "review",
  "classification",
  "research",
  "general",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

const TASK_KEYWORDS: Record<TaskType, string[]> = {
  coding: ["code", "coding", "program", "fix", "debug", "refactor", "function", "script", "test", "bug"],
  writing: ["write", "draft", "email", "doc", "document", "summar", "summarize", "summarise", "copy", "translate"],
  planning: ["plan", "architect", "design", "roadmap", "strategy", "schedule"],
  review: ["review", "audit", "critique", "approve", "validate", "check for"],
  classification: ["classif", "extract", "parse", "label", "tag", "categor", "ner", "entity"],
  research: ["research", "search", "investigate", "analyze", "analysis", "deep"],
  general: [],
};

export function classifyTask(task: string): TaskType {
  const text = task.toLowerCase();
  for (const type of TASK_TYPES) {
    if (type === "general") continue;
    if (TASK_KEYWORDS[type].some((keyword) => text.includes(keyword))) return type;
  }
  return "general";
}

export function findMatchingPolicy(
  policies: PolicyRule[],
  task: string,
  quality: QualityTier,
): PolicyRule | null {
  const taskType = classifyTask(task);
  return (
    policies.find(
      (rule) =>
        rule.quality === quality &&
        (rule.task === taskType || rule.task === task.toLowerCase()),
    ) ?? null
  );
}

export function blendedPrice(entry: { inputPerMillion: number; outputPerMillion: number }): number {
  return (entry.inputPerMillion + entry.outputPerMillion) / 2;
}

export function routeModel(task: string, quality: QualityTier, options: RouteOptions = {}): RouteResult {
  const entries = allPricingEntries();
  const policies = loadPolicies();
  const taskType = classifyTask(task);
  const policy = findMatchingPolicy(policies, task, quality);
  const allowed = new Set(
    policy?.allow.map((model) => model.toLowerCase()) ?? entries.map((e) => e.name.toLowerCase()),
  );
  const denied = new Set((policy?.deny ?? []).map((model) => model.toLowerCase()));

  let effectiveTier = quality;
  let downgraded = false;
  if (options.sessionId !== undefined) {
    const sessions = loadSessions();
    const status = sessionStatus(sessions, loadStore(), options.sessionId)[0];
    if (status) {
      if (status.blocked || status.percent >= 80) {
        const next = downgradeTier(effectiveTier);
        if (next !== effectiveTier) {
          effectiveTier = next;
          downgraded = true;
        }
      }
    }
  }

  const candidates = entries
    .filter((entry) => {
      const meta = qualityMeta(entry.name);
      if (!meta) return false;
      if (tierRank(meta.tier) < tierRank(effectiveTier)) return false;
      if (options.maxCost !== undefined && blendedPrice(entry) > options.maxCost) return false;
      const key = entry.name.toLowerCase();
      if (!allowed.has(key)) return false;
      if (denied.has(key)) return false;
      return true;
    })
    .sort((a, b) => blendedPrice(a) - blendedPrice(b) || tierRank(qualityMeta(a.name)!.tier) - tierRank(qualityMeta(b.name)!.tier));

  const best = candidates[0];
  if (!best) {
    const fallback = entries
      .filter((entry) => {
        const meta = qualityMeta(entry.name);
        if (!meta) return false;
        const key = entry.name.toLowerCase();
        if (denied.has(key)) return false;
        return true;
      })
      .sort((a, b) => blendedPrice(a) - blendedPrice(b))[0];
    if (!fallback) {
      throw new Error(`No model available for quality '${quality}'. Run 'agentcost models' to see the catalog.`);
    }
    const meta = qualityMeta(fallback.name)!;
    return {
      task,
      taskType,
      requestedQuality: quality,
      model: fallback.name,
      provider: fallback.provider,
      tier: meta.tier,
      speed: meta.speed,
      context: meta.context,
      blendedPricePerMillion: blendedPrice(fallback),
      reason: `no model meets quality '${effectiveTier}'; fell back to cheapest available`,
      downgraded,
      policyMatched: policy?.task ?? null,
    };
  }

  const meta = qualityMeta(best.name)!;
  const reason = [
    `cheapest model meeting quality '${effectiveTier}'`,
    options.maxCost !== undefined ? `within $${options.maxCost}/1M blended budget` : undefined,
    policy ? `policy allow-list for '${policy.task}'` : undefined,
    downgraded ? "session near budget limit, tier downgraded" : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join("; ");
  return {
    task,
    taskType,
    requestedQuality: quality,
    model: best.name,
    provider: best.provider,
    tier: meta.tier,
    speed: meta.speed,
    context: meta.context,
    blendedPricePerMillion: blendedPrice(best),
    reason,
    downgraded,
    policyMatched: policy?.task ?? null,
  };
}

export function renderRoute(result: RouteResult): string {
  const lines = [
    `Task        ${pc.cyan(result.task)}`,
    `Task type   ${result.taskType}`,
    `Quality     ${result.requestedQuality}${result.downgraded ? pc.yellow(` (downgraded to ${result.tier})`) : ""}`,
    `Model       ${pc.green(result.model)}`,
    `Provider    ${result.provider}`,
    `Tier        ${result.tier} (speed: ${result.speed}, context: ${result.context.toLocaleString()} tokens)`,
    `Cost        ~$${result.blendedPricePerMillion.toFixed(3)}/1M blended (input+output)`,
    `Reason      ${result.reason}`,
  ];
  return lines.join("\n");
}

export function attachRouteCommand(program: Command): void {
  program
    .command("route")
    .description("Pick the cheapest model that meets a quality tier and budget")
    .requiredOption("--task <description>", "task description (e.g. 'refactor the auth module')")
    .requiredOption("--quality <tier>", "quality tier: low, medium, high or critical")
    .option("--max-cost <amount>", "max blended price per 1M tokens in USD")
    .option("--session <id>", "respect this session's budget (auto-downgrade at 80%)")
    .option("--json", "output machine-readable JSON")
    .action((options: {
      task: string;
      quality: string;
      maxCost?: string;
      session?: string;
      json?: boolean;
    }) => {
      if (!validQuality(options.quality)) {
        process.stderr.write(
          `Invalid --quality value: '${options.quality}'. Use low, medium, high or critical.\n`,
        );
        process.exitCode = 1;
        return;
      }
      let maxCost: number | undefined;
      if (options.maxCost !== undefined) {
        maxCost = parseFloat(options.maxCost.replace(/[$,\s]/g, ""));
        if (!Number.isFinite(maxCost) || maxCost < 0) {
          process.stderr.write(`Invalid --max-cost value: '${options.maxCost}'.\n`);
          process.exitCode = 1;
          return;
        }
      }
      try {
        const result = routeModel(options.task, options.quality, {
          maxCost,
          sessionId: options.session,
        });
        if (options.json) {
          process.stdout.write(JSON.stringify(result) + "\n");
        } else {
          process.stdout.write(renderRoute(result) + "\n");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      }
    });
}

export function attachPolicyCommand(program: Command): void {
  const policy = program
    .command("policy")
    .description("Rules that pin allowed models per task type and quality tier");

  policy
    .command("set")
    .description("Set an allow/deny rule for a task type and quality tier")
    .requiredOption("--task <type>", `task type: ${TASK_TYPES.join(", ")}`)
    .requiredOption("--quality <tier>", "quality tier: low, medium, high or critical")
    .requiredOption("--allow <models>", "comma-separated allowed model names")
    .option("--deny <models>", "comma-separated denied model names")
    .action((options: {
      task: string;
      quality: string;
      allow: string;
      deny?: string;
    }) => {
      const task = options.task.toLowerCase();
      if (!TASK_TYPES.includes(task as TaskType)) {
        process.stderr.write(
          `Invalid --task value: '${options.task}'. Use one of: ${TASK_TYPES.join(", ")}.\n`,
        );
        process.exitCode = 1;
        return;
      }
      if (!validQuality(options.quality)) {
        process.stderr.write(
          `Invalid --quality value: '${options.quality}'. Use low, medium, high or critical.\n`,
        );
        process.exitCode = 1;
        return;
      }
      const allow = options.allow.split(",").map((m) => m.trim()).filter((m) => m.length > 0);
      const deny = options.deny
        ?.split(",").map((m) => m.trim()).filter((m) => m.length > 0);
      if (allow.length === 0) {
        process.stderr.write("Provide at least one model in --allow.\n");
        process.exitCode = 1;
        return;
      }
      const rule: PolicyRule = {
        task,
        quality: options.quality as QualityTier,
        allow,
        deny,
        updatedAt: new Date().toISOString(),
      };
      const policies = loadPolicies();
      const index = policies.findIndex(
        (existing) => existing.task === rule.task && existing.quality === rule.quality,
      );
      if (index >= 0) policies[index] = rule;
      else policies.push(rule);
      savePolicies(policies);
      process.stdout.write(
        `Policy set: '${rule.task}' + quality '${rule.quality}' allows [${rule.allow.join(", ")}].\n`,
      );
    });

  policy
    .command("list")
    .description("List all routing policies")
    .option("--json", "output machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const policies = loadPolicies();
      if (policies.length === 0) {
        process.stdout.write("No policies set. Use 'agentcost policy set' first.\n");
        return;
      }
      if (options.json) {
        process.stdout.write(JSON.stringify({ policies }) + "\n");
        return;
      }
      const rows = policies.map((rule) => [
        rule.task,
        rule.quality,
        rule.allow.join(", "),
        rule.deny?.join(", ") ?? "-",
        rule.updatedAt.slice(0, 10),
      ]);
      process.stdout.write(
        renderTable(
          ["Task", "Quality", "Allow", "Deny", "Updated"],
          rows,
          (_row, col, text) => (col === 0 ? pc.cyan(text) : text),
        ) + "\n",
      );
    });

  policy
    .command("remove")
    .description("Remove a routing policy")
    .requiredOption("--task <type>", "task type")
    .requiredOption("--quality <tier>", "quality tier")
    .action((options: { task: string; quality: string }) => {
      if (!validQuality(options.quality)) {
        process.stderr.write(
          `Invalid --quality value: '${options.quality}'. Use low, medium, high or critical.\n`,
        );
        process.exitCode = 1;
        return;
      }
      const task = options.task.toLowerCase();
      const policies = loadPolicies();
      const next = policies.filter(
        (rule) => !(rule.task === task && rule.quality === options.quality),
      );
      if (next.length === policies.length) {
        process.stderr.write(
          `No policy for '${task}' with quality '${options.quality}'.\n`,
        );
        process.exitCode = 1;
        return;
      }
      savePolicies(next);
      process.stdout.write(`Policy removed for '${task}' with quality '${options.quality}'.\n`);
    });
}