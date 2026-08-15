import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/session";
import { appendStore } from "../src/store";
import { startServer } from "../src/server";
import type { ServerHandle } from "../src/server";

let home: string;
let previous: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "agentcost-server-"));
  previous = process.env.AGENTCOST_HOME;
  process.env.AGENTCOST_HOME = home;
});

afterAll(() => {
  if (previous === undefined) delete process.env.AGENTCOST_HOME;
  else process.env.AGENTCOST_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  writeFileSync(join(home, "store.jsonl"), "", "utf8");
  writeFileSync(join(home, "sessions.json"), "[]", "utf8");
});

async function start(): Promise<ServerHandle> {
  return startServer({ host: "127.0.0.1", port: 0 });
}

describe("server", () => {
  it("serves store, sessions and report over HTTP", async () => {
    const handle = await start();
    appendStore({
      ts: "2026-08-14T10:00:00.000Z",
      model: "gpt-4o",
      provider: "OpenAI",
      inputTokens: 1000,
      outputTokens: 500,
      cost: 0.0075,
    });
    const session = createSession("alpha", 5);

    const store = await (await fetch(`${handle.url}/api/store`)).json();
    expect((store as Array<{ model: string }>)[0].model).toBe("gpt-4o");

    const sessions = await (await fetch(`${handle.url}/api/sessions`)).json();
    expect((sessions as Array<{ id: string }>)[0].id).toBe(session.id);

    const report = await (await fetch(`${handle.url}/api/report`)).json();
    expect((report as { total: { calls: number } }).total.calls).toBe(1);

    const health = await (await fetch(`${handle.url}/health`)).json();
    expect((health as { ok: boolean }).ok).toBe(true);

    const dashboard = await (await fetch(`${handle.url}/dashboard`)).text();
    expect(dashboard).toContain("agentcost dashboard");

    await handle.close();
  });

  it("returns 404 for unknown paths", async () => {
    const handle = await start();
    const response = await fetch(`${handle.url}/nope`);
    expect(response.status).toBe(404);
    await handle.close();
  });
});