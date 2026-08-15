import type { ModelQualityMeta, QualityTier } from "./types";

export const MODEL_META: Record<string, ModelQualityMeta> = {
  "gpt-4o": { tier: "high", speed: "fast", context: 128_000, modalities: ["text", "image"], benchmark: 88.7 },
  "gpt-4o-mini": { tier: "medium", speed: "fast", context: 128_000, modalities: ["text", "image"], benchmark: 82.0 },
  o1: { tier: "critical", speed: "slow", context: 200_000, modalities: ["text"], benchmark: 92.5 },
  "o1-mini": { tier: "high", speed: "medium", context: 128_000, modalities: ["text"], benchmark: 85.0 },
  "gpt-4.1": { tier: "high", speed: "fast", context: 1_000_000, modalities: ["text"], benchmark: 89.0 },
  "gpt-4.1-mini": { tier: "medium", speed: "fast", context: 1_000_000, modalities: ["text"], benchmark: 84.0 },
  "gpt-4.1-nano": { tier: "low", speed: "fast", context: 1_000_000, modalities: ["text"], benchmark: 70.0 },

  "claude-3-7-sonnet": { tier: "high", speed: "medium", context: 200_000, modalities: ["text"], benchmark: 90.0 },
  "claude-3-5-sonnet": { tier: "high", speed: "medium", context: 200_000, modalities: ["text"], benchmark: 88.0 },
  "claude-3-5-haiku": { tier: "medium", speed: "fast", context: 200_000, modalities: ["text"], benchmark: 80.0 },
  "claude-3-opus": { tier: "critical", speed: "slow", context: 200_000, modalities: ["text"], benchmark: 91.0 },

  "deepseek-chat": { tier: "medium", speed: "fast", context: 64_000, modalities: ["text"], benchmark: 82.0 },
  "deepseek-reasoner": { tier: "high", speed: "slow", context: 64_000, modalities: ["text"], benchmark: 87.0 },

  "gemini-2.0-flash": { tier: "medium", speed: "fast", context: 1_000_000, modalities: ["text", "image", "audio"], benchmark: 83.0 },
  "gemini-2.5-pro": { tier: "high", speed: "medium", context: 1_000_000, modalities: ["text", "image", "audio"], benchmark: 89.0 },
  "gemini-1.5-pro": { tier: "high", speed: "medium", context: 2_000_000, modalities: ["text", "image", "audio"], benchmark: 87.0 },

  "grok-2": { tier: "high", speed: "medium", context: 131_000, modalities: ["text"], benchmark: 86.0 },
  "grok-beta": { tier: "high", speed: "medium", context: 131_000, modalities: ["text"], benchmark: 85.0 },

  "mistral-large": { tier: "high", speed: "medium", context: 128_000, modalities: ["text"], benchmark: 84.0 },
  "mistral-small": { tier: "medium", speed: "fast", context: 128_000, modalities: ["text"], benchmark: 78.0 },

  "llama-3.3-70b": { tier: "medium", speed: "medium", context: 128_000, modalities: ["text"], benchmark: 82.0 },
  "llama-3.1-8b": { tier: "low", speed: "fast", context: 128_000, modalities: ["text"], benchmark: 70.0 },
};

export const TIER_ORDER: QualityTier[] = ["low", "medium", "high", "critical"];

export function tierRank(tier: QualityTier): number {
  return TIER_ORDER.indexOf(tier);
}

export function qualityMeta(model: string): ModelQualityMeta | null {
  return MODEL_META[model] ?? null;
}

export function meetsQuality(model: string, required: QualityTier): boolean {
  const meta = qualityMeta(model);
  if (!meta) return false;
  return tierRank(meta.tier) >= tierRank(required);
}

export function downgradeTier(tier: QualityTier): QualityTier {
  const index = tierRank(tier);
  return TIER_ORDER[Math.max(0, index - 1)];
}

export function requireHigherTier(tier: QualityTier): QualityTier {
  const index = tierRank(tier);
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, index + 1)];
}

export function validQuality(value: string): value is QualityTier {
  return TIER_ORDER.includes(value as QualityTier);
}