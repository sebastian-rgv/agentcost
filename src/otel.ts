import type { StoreEntry } from "./types";

export interface OtelMetric {
  name: string;
  value: number;
  unit?: string;
  description?: string;
  tags: Record<string, string>;
}

export function toOtlpJson(metrics: OtelMetric[]): unknown {
  const nowNs = Math.floor(Date.now() * 1_000_000);
  const scopeMetrics = metrics.map((metric) => {
    const attributes = Object.entries(metric.tags).map(([key, value]) => ({
      key,
      value: { stringValue: value },
    }));
    const dataPoint = {
      attributes,
      timeUnixNano: String(nowNs),
      asDouble: metric.value,
    };
    return {
      name: metric.name,
      description: metric.description ?? "",
      unit: metric.unit ?? "1",
      sum: {
        dataPoints: [dataPoint],
        isMonotonic: false,
        aggregationTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      },
    };
  });
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: "agentcost" } }] },
        scopeMetrics: [
          {
            scope: { name: "agentcost" },
            metrics: scopeMetrics,
          },
        ],
      },
    ],
  };
}

export async function emitMetrics(endpoint: string, metrics: OtelMetric[]): Promise<number> {
  const url = endpoint.endsWith("/v1/metrics")
    ? endpoint
    : `${endpoint.replace(/\/+$/, "")}/v1/metrics`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(toOtlpJson(metrics)),
  });
  if (!response.ok) {
    throw new Error(`OTLP endpoint returned HTTP ${response.status} ${response.statusText}`);
  }
  return metrics.length;
}

export function metricsFromStore(entries: StoreEntry[], tags: Record<string, string> = {}): OtelMetric[] {
  const byModel = new Map<string, { calls: number; cost: number; input: number; output: number }>();
  for (const entry of entries) {
    const bucket = byModel.get(entry.model) ?? { calls: 0, cost: 0, input: 0, output: 0 };
    bucket.calls += 1;
    bucket.cost += entry.cost ?? 0;
    bucket.input += entry.inputTokens;
    bucket.output += entry.outputTokens;
    byModel.set(entry.model, bucket);
  }
  const base = {
    project: tags.project ?? "all",
    provider: tags.provider ?? "all",
    session: tags.session ?? "all",
  };
  const metrics: OtelMetric[] = [];
  let totalCost = 0;
  let totalCalls = 0;
  for (const [model, bucket] of byModel) {
    const modelTags = { ...base, model };
    metrics.push({ name: "agentcost.calls", value: bucket.calls, tags: modelTags });
    metrics.push({ name: "agentcost.tokens.input", value: bucket.input, tags: modelTags });
    metrics.push({ name: "agentcost.tokens.output", value: bucket.output, tags: modelTags });
    metrics.push({ name: "agentcost.cost", value: bucket.cost, unit: "USD", tags: modelTags });
    totalCost += bucket.cost;
    totalCalls += bucket.calls;
  }
  metrics.push({ name: "agentcost.calls.total", value: totalCalls, tags: base });
  metrics.push({ name: "agentcost.cost.total", value: totalCost, unit: "USD", tags: base });
  return metrics;
}

export async function emitStoreMetrics(
  endpoint: string,
  entries: StoreEntry[],
  tags: Record<string, string> = {},
): Promise<number> {
  return emitMetrics(endpoint, metricsFromStore(entries, tags));
}