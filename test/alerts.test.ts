import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evaluateAlertsForThresholds, hasAlertChannels } from "../src/alerts";
import { loadAlertConfig, loadAlertState, saveAlertConfig, saveAlertState } from "../src/store";
import type { AlertEvent } from "../src/types";

let home: string;
let previous: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "agentcost-alerts-"));
  previous = process.env.AGENTCOST_HOME;
  process.env.AGENTCOST_HOME = home;
});

afterAll(() => {
  if (previous === undefined) delete process.env.AGENTCOST_HOME;
  else process.env.AGENTCOST_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  writeFileSync(join(home, "alerts-state.json"), "{}", "utf8");
  writeFileSync(join(home, "alerts.json"), "{}", "utf8");
});

function event(percent: number, name = "s1"): AlertEvent {
  return { name, limit: 10, spent: percent / 10, percent, kind: "session" };
}

describe("alerts", () => {
  it("fires once per threshold and records state", async () => {
    saveAlertConfig({ enabled: true, webhook: "http://localhost:9/nonexistent", updatedAt: new Date().toISOString() });
    const first = await evaluateAlertsForThresholds([event(80)]);
    const second = await evaluateAlertsForThresholds([event(80)]);
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(Object.keys(loadAlertState())).toContain("session:s1:warning");
  });

  it("fires warning and over thresholds at 100%", async () => {
    saveAlertConfig({ enabled: true, webhook: "http://localhost:9/nonexistent", updatedAt: new Date().toISOString() });
    const fired = await evaluateAlertsForThresholds([event(100)]);
    expect(fired).toBe(2);
  });

  it("does nothing when alerts are disabled", async () => {
    saveAlertConfig({ enabled: false, webhook: "http://localhost:9/nonexistent", updatedAt: new Date().toISOString() });
    expect(await evaluateAlertsForThresholds([event(100)])).toBe(0);
  });

  it("clear resets the fired state", async () => {
    saveAlertConfig({ enabled: true, webhook: "http://localhost:9/nonexistent", updatedAt: new Date().toISOString() });
    await evaluateAlertsForThresholds([event(80)]);
    saveAlertState({});
    expect(await evaluateAlertsForThresholds([event(80)])).toBe(1);
  });

  it("detects whether channels are configured", () => {
    expect(hasAlertChannels(null)).toBe(false);
    expect(hasAlertChannels({ enabled: true, updatedAt: new Date().toISOString() })).toBe(false);
    saveAlertConfig({ enabled: true, slackWebhook: "https://hooks.slack.com/x", updatedAt: new Date().toISOString() });
    expect(hasAlertChannels(loadAlertConfig())).toBe(true);
  });
});