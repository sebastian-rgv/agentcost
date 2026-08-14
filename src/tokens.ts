import { getEncoding } from "js-tiktoken";
import type { Tiktoken, TiktokenEncoding } from "js-tiktoken";
import type { Command } from "commander";

const KNOWN_O200K_MODELS = new Set(["o1", "gpt-4o", "gpt-4o-mini", "gpt-4.1"]);

const cache = new Map<TiktokenEncoding, Tiktoken>();

function getEncodingCached(encoding: TiktokenEncoding): Tiktoken {
  const existing = cache.get(encoding);
  if (existing) return existing;
  const instance = getEncoding(encoding);
  cache.set(encoding, instance);
  return instance;
}

export function resolveEncoding(model: string): {
  encoding: TiktokenEncoding;
  warning?: string;
} {
  const key = model.toLowerCase();
  if (key.startsWith("claude")) {
    return { encoding: "cl100k_base" };
  }
  if (KNOWN_O200K_MODELS.has(key)) {
    return { encoding: "o200k_base" };
  }
  return {
    encoding: "o200k_base",
    warning: `Warning: model '${model}' has no known encoding; using o200k_base.`,
  };
}

export interface TokenCount {
  tokens: number;
  model: string;
  encoding: string;
  warning?: string;
}

export function countTokens(text: string, model: string): TokenCount {
  const { encoding, warning } = resolveEncoding(model);
  try {
    const encodingInstance = getEncodingCached(encoding);
    return { tokens: encodingInstance.encode(text).length, model, encoding, warning };
  } catch {
    return {
      tokens: Math.ceil(text.length / 4),
      model,
      encoding: "estimate",
      warning: `Warning: tokenizer unavailable for '${model}'; using chars/4 estimate.`,
    };
  }
}

export function attachTokensCommand(program: Command): void {
  program
    .command("tokens")
    .description("Count tokens in a text using the model's tokenizer")
    .argument("<text>", "text to count")
    .option("--model <model>", "model name (e.g. gpt-4o)", "gpt-4o")
    .option("--json", "output machine-readable JSON")
    .action((text: string, options: { model?: string; json?: boolean }) => {
      const model = options.model ?? "gpt-4o";
      const result = countTokens(text, model);
      if (result.warning) process.stderr.write(result.warning + "\n");
      if (options.json) {
        process.stdout.write(
          JSON.stringify({ tokens: result.tokens, model, encoding: result.encoding }) + "\n",
        );
      } else {
        process.stdout.write(
          `${result.tokens} token${result.tokens === 1 ? "" : "s"} (${result.encoding})\n`,
        );
      }
    });
}