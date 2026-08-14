import pc from "picocolors";
import type { Command } from "commander";
import { findModel, normalizeModelId, PRICING } from "./pricing";
import { formatMoney } from "./types";
import type { CostBreakdown, EstimateResult, ModelPricing } from "./types";

export function calculateCost(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
): CostBreakdown {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

export class ModelNotFoundError extends Error {
  public readonly suggestions: string[];

  public constructor(public readonly model: string, suggestions: string[]) {
    super(`Model '${model}' not found in the pricing database.`);
    this.name = "ModelNotFoundError";
    this.suggestions = suggestions;
  }
}

function levenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  const matrix: number[] = Array.from({ length: bl + 1 }, (_, i) => i);
  for (let i = 1; i <= al; i += 1) {
    let prev = matrix[0];
    matrix[0] = i;
    for (let j = 1; j <= bl; j += 1) {
      const tmp = matrix[j];
      matrix[j] = Math.min(
        matrix[j] + 1,
        matrix[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return matrix[bl];
}

export function suggestModels(model: string, limit = 3): string[] {
  const normalized = normalizeModelId(model).toLowerCase();
  const modelLower = model.toLowerCase();
  return Object.keys(PRICING)
    .map((name) => {
      const distance = Math.min(
        levenshtein(model, name),
        levenshtein(modelLower, name.toLowerCase()),
        levenshtein(normalized, name.toLowerCase()),
      );
      return { name, distance };
    })
    .sort((x, y) => x.distance - y.distance || x.name.localeCompare(y.name))
    .slice(0, limit)
    .map((entry) => entry.name);
}

export function estimate(
  model: string,
  inputTokens: number,
  outputTokens: number,
): EstimateResult {
  const pricing = findModel(model);
  if (!pricing) {
    throw new ModelNotFoundError(model, suggestModels(model));
  }
  const breakdown = calculateCost(pricing, inputTokens, outputTokens);
  return {
    model,
    provider: pricing.provider,
    inputTokens,
    outputTokens,
    ...breakdown,
  };
}

function printEstimate(result: EstimateResult): void {
  const money = (label: string, value: number, bold = false): string => {
    const text = `${label.padEnd(10)}${pc.green(`$${formatMoney(value)}`)}`;
    return bold ? pc.bold(text) : text;
  };
  const lines = [
    `Model     ${pc.cyan(result.model)}`,
    `Provider  ${result.provider}`,
    money("Input", result.inputCost),
    `          ${result.inputTokens.toLocaleString()} tokens`,
    money("Output", result.outputCost),
    `          ${result.outputTokens.toLocaleString()} tokens`,
    money("Total", result.totalCost, true),
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

export function attachEstimateCommand(program: Command): void {
  program
    .command("estimate")
    .description("Estimate the USD cost of a single LLM call")
    .requiredOption("--model <model>", "model name (e.g. gpt-4o)")
    .requiredOption("--input <tokens>", "number of input tokens")
    .requiredOption("--output <tokens>", "number of output tokens")
    .option("--json", "output machine-readable JSON")
    .action((options: {
      model: string;
      input: string;
      output: string;
      json?: boolean;
    }) => {
      const inputTokens = parseInt(options.input, 10);
      const outputTokens = parseInt(options.output, 10);
      if (!Number.isFinite(inputTokens) || inputTokens < 0) {
        process.stderr.write(`Invalid --input value: '${options.input}'\n`);
        process.exitCode = 1;
        return;
      }
      if (!Number.isFinite(outputTokens) || outputTokens < 0) {
        process.stderr.write(`Invalid --output value: '${options.output}'\n`);
        process.exitCode = 1;
        return;
      }
      try {
        const result = estimate(options.model, inputTokens, outputTokens);
        if (options.json) {
          process.stdout.write(JSON.stringify(result) + "\n");
        } else {
          printEstimate(result);
        }
      } catch (error) {
        if (error instanceof ModelNotFoundError) {
          process.stderr.write(`${error.message}\n`);
          if (error.suggestions.length > 0) {
            process.stderr.write(`Did you mean: ${error.suggestions.join(", ")}?\n`);
          }
          process.stderr.write(
            "Use 'agentcost models' to list all available models.\n",
          );
          process.exitCode = 1;
          return;
        }
        throw error;
      }
    });
}