import { resolveModel } from "./pricing";
import { appendStore, loadStore } from "./store";
import { createSession, endSession, findSession, sessionStatus } from "./session";
import { routeModel } from "./route";
import type { RouteResult, Session, SessionStatus, StoreEntry } from "./types";
import type { QualityTier } from "./types";

export interface ReportUsageInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
  provider?: string;
  cost?: number;
  project?: string;
  agent?: string;
  sessionId?: string;
  task?: string;
  kind?: "call" | "retry" | "error";
  toolCalls?: number;
  latencyMs?: number;
  contextWindow?: number;
  ts?: string;
}

export interface SdkCheckResult {
  status: SessionStatus;
  ok: boolean;
  reason: string;
}

export class BlockedSessionError extends Error {
  public constructor(public readonly sessionId: string) {
    super(`Session '${sessionId}' is blocked by the kill switch.`);
    this.name = "BlockedSessionError";
  }
}

export class UnknownSessionError extends Error {
  public constructor(public readonly sessionId: string) {
    super(`Session '${sessionId}' not found. Start one with 'agentcost session start'.`);
    this.name = "UnknownSessionError";
  }
}

function validateSession(id?: string): Session | null {
  if (id === undefined) return null;
  const session = findSession(id);
  if (!session) throw new UnknownSessionError(id);
  if (session.blocked) throw new BlockedSessionError(id);
  return session;
}

export function reportUsage(input: ReportUsageInput): StoreEntry {
  validateSession(input.sessionId);
  const resolved = resolveModel(input.model);
  const cost =
    input.cost ??
    (resolved
      ? (input.inputTokens / 1_000_000) * resolved.pricing.inputPerMillion +
        (input.outputTokens / 1_000_000) * resolved.pricing.outputPerMillion
      : undefined);
  const entry: StoreEntry = {
    ts: input.ts ?? new Date().toISOString(),
    model: input.model,
    provider: input.provider ?? resolved?.pricing.provider ?? "unknown",
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cost: cost ?? null,
    project: input.project,
    agent: input.agent,
    sessionId: input.sessionId,
    task: input.task,
    kind: input.kind,
    toolCalls: input.toolCalls,
    latencyMs: input.latencyMs,
    contextWindow: input.contextWindow,
  };
  appendStore(entry);
  return entry;
}

export function checkSession(id: string): SdkCheckResult {
  const session = findSession(id);
  if (!session) throw new UnknownSessionError(id);
  const status = sessionStatus([session], loadStore(), id)[0];
  const blocked = status.blocked;
  const over = status.percent >= 100;
  return {
    status,
    ok: !over && !blocked,
    reason: blocked
      ? "session blocked by kill switch"
      : over
        ? "session over limit"
        : "within limit",
  };
}

export interface RouteOptions {
  maxCost?: number;
  sessionId?: string;
}

export const sdk = {
  reportUsage,
  checkSession,
  route: (task: string, quality: QualityTier, options: RouteOptions = {}): RouteResult =>
    routeModel(task, quality, options),
  createSession,
  endSession,
};