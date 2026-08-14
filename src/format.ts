export type LogFormat = "auto" | "openai" | "anthropic";

export function parseLogFormat(value: string | undefined): LogFormat | null {
  if (value === undefined) return "auto";
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto" || normalized === "openai" || normalized === "anthropic") {
    return normalized;
  }
  return null;
}

export function isSupportedLogExtension(name: string): boolean {
  return /\.(jsonl|ndjson|log)$/i.test(name);
}