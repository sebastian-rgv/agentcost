import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { Command } from "commander";
import type { ModelPricing, ResolvedPricingEntry } from "./types";
import { pricingOverridesPath } from "./store";

export const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4o": { provider: "OpenAI", inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { provider: "OpenAI", inputPerMillion: 0.15, outputPerMillion: 0.6 },
  o1: { provider: "OpenAI", inputPerMillion: 15, outputPerMillion: 60 },
  "o1-mini": { provider: "OpenAI", inputPerMillion: 1.1, outputPerMillion: 4.4 },
  "gpt-4.1": { provider: "OpenAI", inputPerMillion: 2, outputPerMillion: 8 },
  "gpt-4.1-mini": { provider: "OpenAI", inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "gpt-4.1-nano": { provider: "OpenAI", inputPerMillion: 0.1, outputPerMillion: 0.4 },

  // Anthropic
  "claude-3-7-sonnet": { provider: "Anthropic", inputPerMillion: 3, outputPerMillion: 15 },
  "claude-3-5-sonnet": { provider: "Anthropic", inputPerMillion: 3, outputPerMillion: 15 },
  "claude-3-5-haiku": { provider: "Anthropic", inputPerMillion: 0.8, outputPerMillion: 4 },
  "claude-3-opus": { provider: "Anthropic", inputPerMillion: 15, outputPerMillion: 75 },

  // DeepSeek
  "deepseek-chat": { provider: "DeepSeek", inputPerMillion: 0.27, outputPerMillion: 1.1 },
  "deepseek-reasoner": { provider: "DeepSeek", inputPerMillion: 0.55, outputPerMillion: 2.19 },

  // Google
  "gemini-2.0-flash": { provider: "Google", inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gemini-2.5-pro": { provider: "Google", inputPerMillion: 1.25, outputPerMillion: 10 },
  "gemini-1.5-pro": { provider: "Google", inputPerMillion: 1.25, outputPerMillion: 5 },

  // xAI
  "grok-2": { provider: "xAI", inputPerMillion: 2, outputPerMillion: 10 },
  "grok-beta": { provider: "xAI", inputPerMillion: 5, outputPerMillion: 15 },

  // Mistral
  "mistral-large": { provider: "Mistral", inputPerMillion: 2, outputPerMillion: 6 },
  "mistral-small": { provider: "Mistral", inputPerMillion: 0.2, outputPerMillion: 0.6 },

  // Meta
  "llama-3.3-70b": { provider: "Meta", inputPerMillion: 0.59, outputPerMillion: 0.79 },
  "llama-3.1-8b": { provider: "Meta", inputPerMillion: 0.05, outputPerMillion: 0.08 },
};

export const DEFAULT_PRICING_URL =
  "https://gist.githubusercontent.com/agentcost/pricing/raw/pricing.json";

export function normalizeModelId(raw: string): string {
  const base = raw.split(":").pop()?.trim() ?? raw;
  const withoutDate = base
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-\d{12}$/, "");
  return withoutDate;
}

export function findModel(model: string): ModelPricing | undefined {
  const direct = PRICING[model];
  if (direct) return direct;
  const normalized = normalizeModelId(model);
  if (normalized !== model) return PRICING[normalized];
  return undefined;
}

function parsePricingValue(value: unknown): ModelPricing | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const input = typeof obj.inputPerMillion === "number" && Number.isFinite(obj.inputPerMillion)
    ? obj.inputPerMillion : null;
  const output = typeof obj.outputPerMillion === "number" && Number.isFinite(obj.outputPerMillion)
    ? obj.outputPerMillion : null;
  if (input === null || output === null) return null;
  return {
    provider: typeof obj.provider === "string" ? obj.provider : "unknown",
    inputPerMillion: input,
    outputPerMillion: output,
  };
}

export function parsePricingData(value: unknown): Record<string, ModelPricing> {
  if (typeof value !== "object" || value === null) return {};
  const result: Record<string, ModelPricing> = {};
  for (const [name, entry] of Object.entries(value)) {
    const pricing = parsePricingValue(entry);
    if (pricing) result[name] = pricing;
  }
  return result;
}

export function loadOverridesFile(path = pricingOverridesPath()): Record<string, ModelPricing> | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const parsed = parsePricingData(data);
    return Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export interface ResolvedModel {
  pricing: ModelPricing;
  overridden: boolean;
}

export function resolveModel(model: string, overridesFile?: string): ResolvedModel | null {
  const overrides = overridesFile
    ? loadOverridesFile(overridesFile)
    : loadOverridesFile();
  if (overrides) {
    const normalized = normalizeModelId(model);
    const override = overrides[model] ?? overrides[normalized];
    if (override) return { pricing: override, overridden: true };
  }
  const builtin = findModel(model);
  if (builtin) return { pricing: builtin, overridden: false };
  return null;
}

export function allPricingEntries(overridesFile?: string): ResolvedPricingEntry[] {
  const entries: ResolvedPricingEntry[] = [];
  const names = new Set<string>();
  for (const [name, pricing] of Object.entries(PRICING)) {
    names.add(name);
    entries.push({ name, ...pricing, overridden: false, source: "builtin" });
  }
  const overrides = overridesFile
    ? loadOverridesFile(overridesFile)
    : loadOverridesFile();
  if (overrides) {
    for (const [name, pricing] of Object.entries(overrides)) {
      if (names.has(name)) {
        const index = entries.findIndex((entry) => entry.name === name);
        entries[index] = { name, ...pricing, overridden: true, source: "override" };
      } else {
        names.add(name);
        entries.push({ name, ...pricing, overridden: true, source: "override" });
      }
    }
  }
  return entries.sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
  );
}

export class PricingSyncError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PricingSyncError";
  }
}

export async function syncPricing(url?: string): Promise<{ path: string; models: string[] }> {
  const source = url ?? DEFAULT_PRICING_URL;
  let data: unknown;
  if (!/^https?:\/\//i.test(source)) {
    const filePath = source.startsWith("file://") ? source.slice("file://".length) : source;
    try {
      data = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PricingSyncError(`Cannot read pricing file '${source}': ${message}`);
    }
  } else {
    try {
      const response = await fetch(source);
      if (!response.ok) {
        throw new PricingSyncError(`HTTP ${response.status} ${response.statusText}`);
      }
      data = (await response.json()) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PricingSyncError(`Failed to fetch pricing from '${source}': ${message}`);
    }
  }
  const parsed = parsePricingData(data);
  if (Object.keys(parsed).length === 0) {
    throw new PricingSyncError(
      `No valid pricing entries found in '${source}'. Expected { "model": { provider, inputPerMillion, outputPerMillion } }`,
    );
  }
  const outPath = pricingOverridesPath();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  return { path: outPath, models: Object.keys(parsed).sort() };
}

export function resetOverrides(): boolean {
  try {
    rmSync(pricingOverridesPath(), { force: true });
    return true;
  } catch {
    return false;
  }
}

export function attachPricingCommand(program: Command): void {
  const pricing = program
    .command("pricing")
    .description("Manage local price overrides");
  pricing
    .command("sync")
    .description("Download a pricing JSON from a registry and save local overrides")
    .option("--url <url>", "registry URL or local JSON file path")
    .action(async (options: { url?: string }) => {
      try {
        const result = await syncPricing(options.url);
        process.stdout.write(
          `Saved ${result.models.length} price override(s) to ${result.path}\n`,
        );
        process.stdout.write(`Models: ${result.models.join(", ")}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`pricing sync failed: ${message}\n`);
        process.exitCode = 1;
      }
    });
  pricing
    .command("reset")
    .description("Remove local price overrides")
    .action(() => {
      if (resetOverrides()) {
        process.stdout.write("Removed local price overrides.\n");
      } else {
        process.stderr.write("No local price overrides to remove.\n");
      }
    });
}