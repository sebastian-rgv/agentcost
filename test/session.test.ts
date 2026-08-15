import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activeSessions,
  blockSession,
  createSession,
  endSession,
  generateSessionId,
  parseLimit,
  sessionSpend,
  sessionStatus,
  unblockSession,
} from "../src/session";
import { loadStore, loadSessions, appendStore } from "../src/store";
import type { StoreEntry } from "../src/types";

let home: string;
let previous: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "agentcost-session-"));
  previous = process.env.AGENTCOST_HOME;
  process.env.AGENTCOST_HOME = home;
});

afterAll(() => {
  if (previous === undefined) delete process.env.AGENTCOST_HOME;
  else process.env.AGENTCOST_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  writeFileSync(join(home, "sessions.json"), "[]", "utf8");
  writeFileSync(join(home, "store.jsonl"), "", "utf8");
});

function entry(overrides: Partial<StoreEntry>): StoreEntry {
  return {
    ts: new Date().toISOString(),
    model: "gpt-4o",
    provider: "OpenAI",
    inputTokens: 1000,
    outputTokens: 500,
    cost: 0.0075,
    ...overrides,
  };
}

describe("sessions", () => {
  it("generates unique session ids", () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).toMatch(/^ses_/);
    expect(a).not.toBe(b);
  });

  it("parses limits with currency symbols", () => {
    expect(parseLimit("5")).toBe(5);
    expect(parseLimit("$5.50")).toBe(5.5);
    expect(parseLimit("$ 10,000")).toBe(10000);
    expect(() => parseLimit("abc")).toThrow(/Invalid/);
  });

  it("creates, lists and ends sessions", () => {
    const session = createSession("alpha", 5);
    expect(session.id).toMatch(/^ses_/);
    expect(activeSessions()).toHaveLength(1);
    const ended = endSession(session.id);
    expect(ended?.endedAt).toBeDefined();
    expect(activeSessions()).toHaveLength(0);
  });

  it("rejects invalid sessions", () => {
    expect(() => createSession("", 5)).toThrow(/empty/);
  });

  it("computes spend from store entries tagged with the session", () => {
    const session = createSession("alpha", 5);
    appendStore(entry({ sessionId: session.id, cost: 2.3 }));
    appendStore(entry({ sessionId: session.id, cost: 1.1 }));
    appendStore(entry({ cost: 9 }));
    expect(sessionSpend(loadStore(), session.id)).toBeCloseTo(3.4, 10);
  });

  it("reports status levels and remaining budget", () => {
    const session = createSession("alpha", 10);
    appendStore(entry({ sessionId: session.id, cost: 4 }));
    const [status] = sessionStatus([session], loadStore(), session.id);
    expect(status.percent).toBeCloseTo(40, 10);
    expect(status.remaining).toBeCloseTo(6, 10);
    expect(status.level).toBe("ok");
    expect(status.active).toBe(true);

    appendStore(entry({ sessionId: session.id, cost: 4 }));
    const [warning] = sessionStatus([session], loadStore(), session.id);
    expect(warning.level).toBe("warning");

    appendStore(entry({ sessionId: session.id, cost: 2 }));
    const [over] = sessionStatus([session], loadStore(), session.id);
    expect(over.level).toBe("over");
    expect(over.remaining).toBe(0);
  });

  it("kill switch blocks sessions and unblocks them", () => {
    const session = createSession("alpha", 10);
    expect(blockSession(session.id)?.blocked).toBe(true);
    const [status] = sessionStatus(loadSessions(), loadStore(), session.id);
    expect(status.blocked).toBe(true);
    expect(unblockSession(session.id)?.blocked).toBe(false);
  });
});