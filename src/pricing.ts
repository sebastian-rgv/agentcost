import type { ModelPricing } from "./types";

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