import pc from "picocolors";
import type { Command } from "commander";
import { allPricingEntries } from "./pricing";
import { formatMoney, renderTable } from "./types";
import type { ModelEntry } from "./types";

export function listModels(provider?: string, pricingFile?: string): ModelEntry[] {
  const filter = provider?.trim().toLowerCase();
  return allPricingEntries(pricingFile)
    .filter((entry) => filter === undefined || entry.provider.toLowerCase() === filter)
    .map((entry) => ({
      name: entry.name,
      provider: entry.provider,
      inputPerMillion: entry.inputPerMillion,
      outputPerMillion: entry.outputPerMillion,
      overridden: entry.overridden,
    }));
}

export function renderModels(entries: ModelEntry[]): string {
  const headers = ["Model", "Provider", "Input $/1M", "Output $/1M"];
  const rows = entries.map((entry) => [
    entry.overridden ? `${entry.name}*` : entry.name,
    entry.provider,
    formatMoney(entry.inputPerMillion),
    formatMoney(entry.outputPerMillion),
  ]);
  return renderTable(
    headers,
    rows,
    (_row, col, text) => {
      if (col === 0) return pc.cyan(text);
      if (col === 2 || col === 3) return pc.green(text);
      return text;
    },
  );
}

export function printModels(entries: ModelEntry[], json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify({ models: entries }) + "\n");
    return;
  }
  if (entries.length === 0) {
    process.stdout.write("No models found for the given provider.\n");
    return;
  }
  process.stdout.write(renderModels(entries) + "\n");
  if (entries.some((entry) => entry.overridden)) {
    process.stderr.write("* price from local overrides\n");
  }
}

export function attachModelsCommand(program: Command): void {
  program
    .command("models")
    .description("List all models and their prices per 1M tokens")
    .option("--provider <name>", "filter by provider (e.g. OpenAI)")
    .option("--pricing-file <path>", "load a local pricing JSON file")
    .option("--json", "output machine-readable JSON")
    .action((options: {
      provider?: string;
      pricingFile?: string;
      json?: boolean;
    }) => {
      printModels(listModels(options.provider, options.pricingFile), options.json === true);
    });
}