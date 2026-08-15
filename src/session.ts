import { randomBytes } from "node:crypto";
import pc from "picocolors";
import type { Command } from "commander";
import type { BudgetLevel, Session, SessionStatus, StoreEntry } from "./types";
import { loadSessions, loadStore, saveSessions } from "./store";
import { formatMoney, renderTable } from "./types";

export function generateSessionId(): string {
  return `ses_${randomBytes(12).toString("base64url")}`;
}

export function parseLimit(value: string): number {
  const cleaned = value.trim().replace(/[$,\s]/g, "");
  const amount = parseFloat(cleaned);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid --limit value: '${value}'. Use a non-negative number (e.g. 5 or $5).`);
  }
  return amount;
}

export function createSession(project: string, limit: number): Session {
  const name = project.trim();
  if (name.length === 0) {
    throw new Error("Project name cannot be empty.");
  }
  const session: Session = {
    id: generateSessionId(),
    project: name,
    limit,
    startedAt: new Date().toISOString(),
  };
  const sessions = loadSessions();
  sessions.push(session);
  saveSessions(sessions);
  return session;
}

export function findSession(id: string): Session | null {
  return loadSessions().find((session) => session.id === id) ?? null;
}

export function endSession(id: string): Session | null {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === id);
  if (!session) return null;
  if (session.endedAt === undefined) {
    session.endedAt = new Date().toISOString();
    saveSessions(sessions);
  }
  return session;
}

export function endLatestActiveSession(): Session | null {
  const sessions = loadSessions();
  const active = sessions.filter((s) => s.endedAt === undefined);
  if (active.length === 0) return null;
  active.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return endSession(active[0].id);
}

export function listSessions(): Session[] {
  return loadSessions().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function activeSessions(): Session[] {
  return listSessions().filter((session) => session.endedAt === undefined);
}

export function sessionSpend(entries: StoreEntry[], id: string): number {
  return entries.reduce((sum, entry) => {
    if (entry.sessionId !== id) return sum;
    return sum + (entry.cost ?? 0);
  }, 0);
}

export function sessionStatus(
  sessions: Session[],
  entries: StoreEntry[],
  id?: string,
): SessionStatus[] {
  const pool = id !== undefined ? sessions.filter((s) => s.id === id) : sessions;
  return pool.map((session) => {
    const spent = sessionSpend(entries, session.id);
    const percent =
      session.limit === 0 ? (spent > 0 ? Infinity : 0) : (spent / session.limit) * 100;
    let level: BudgetLevel = "ok";
    if (percent >= 100) level = "over";
    else if (percent >= 80) level = "warning";
    return {
      id: session.id,
      project: session.project,
      limit: session.limit,
      spent,
      percent,
      remaining: Math.max(0, session.limit - spent),
      level,
      active: session.endedAt === undefined,
      blocked: session.blocked === true,
    };
  });
}

export function blockSession(id: string): Session | null {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === id);
  if (!session) return null;
  session.blocked = true;
  saveSessions(sessions);
  return session;
}

export function unblockSession(id: string): Session | null {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === id);
  if (!session) return null;
  session.blocked = false;
  saveSessions(sessions);
  return session;
}

export function renderSessionStatus(statuses: SessionStatus[]): string {
  const headers = ["ID", "Project", "Spent", "Limit", "Percent", "State"];
  const rows = statuses.map((status) => [
    status.id,
    status.project,
    `$${formatMoney(status.spent)}`,
    `$${formatMoney(status.limit)}`,
    Number.isFinite(status.percent) ? `${status.percent.toFixed(1)}%` : "over",
    `${status.active ? "active" : "ended"}${status.blocked ? ", blocked" : ""}`,
  ]);
  const color = (row: number, col: number, text: string): string => {
    if (row < 0) return text;
    if (col === 2) return pc.green(text);
    if (col === 4) {
      const level = statuses[row].level;
      if (level === "over") return pc.red(text);
      if (level === "warning") return pc.yellow(text);
      return text;
    }
    if (col === 0) return pc.cyan(text);
    return text;
  };
  return renderTable(headers, rows, color);
}

export function renderCheckStatus(status: SessionStatus): string {
  const limit = `$${formatMoney(status.limit)}`;
  const spent = `$${formatMoney(status.spent)}`;
  const remaining = `$${formatMoney(status.remaining)}`;
  const percent = Number.isFinite(status.percent)
    ? `${status.percent.toFixed(1)}%`
    : "over";
  const color = (text: string): string => {
    if (status.level === "over") return pc.red(text);
    if (status.level === "warning") return pc.yellow(text);
    return pc.green(text);
  };
  return [
    `session ${status.id} (${status.project})`,
    `spent ${color(spent)} / ${limit}  (${color(percent)}, remaining ${remaining})`,
    status.blocked ? pc.red("BLOCKED by kill switch") : `state: ${status.active ? "active" : "ended"}`,
  ].join("\n");
}

export function attachSessionCommand(program: Command): void {
  const session = program
    .command("session")
    .description("Manage ephemeral agent sessions with spending limits");

  session
    .command("start")
    .description("Start an ephemeral session with a spending limit")
    .requiredOption("--project <name>", "project name")
    .requiredOption("--limit <amount>", "session spending limit in USD (e.g. 5 or $5)")
    .action((options: { project: string; limit: string }) => {
      try {
        const created = createSession(options.project, parseLimit(options.limit));
        process.stdout.write(
          `Session started: ${pc.cyan(created.id)} (project '${created.project}', limit $${formatMoney(created.limit)}).\n`,
        );
        process.stdout.write(
          "Tag usage with '--session' and query it with 'agentcost check --session'.\n",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      }
    });

  session
    .command("end")
    .description("End a session (defaults to the most recently started active one)")
    .option("--id <id>", "session id to end")
    .action((options: { id?: string }) => {
      const id = options.id ?? endLatestActiveSession()?.id ?? "";
      if (id.length === 0) {
        process.stderr.write("No active sessions to end.\n");
        process.exitCode = 1;
        return;
      }
      const ended = endSession(id);
      if (!ended) {
        process.stderr.write(`Session '${id}' not found.\n`);
        process.exitCode = 1;
        return;
      }
      const status = sessionStatus(loadSessions(), loadStore(), ended.id)[0];
      process.stdout.write(
        `Session ${ended.id} ended. Total spent $${formatMoney(status.spent)} of $${formatMoney(status.limit)}.\n`,
      );
    });

  session
    .command("list")
    .description("List sessions with their current spending")
    .option("--active", "only show active sessions")
    .option("--json", "output machine-readable JSON")
    .action((options: { active?: boolean; json?: boolean }) => {
      const sessions = listSessions();
      if (options.active) {
        const filtered = sessions.filter((s) => s.endedAt === undefined);
        if (filtered.length === 0) {
          process.stdout.write("No active sessions.\n");
          return;
        }
      }
      const entries = loadStore();
      const statuses = sessionStatus(sessions, entries).filter((status) =>
        options.active ? status.active : true,
      );
      if (statuses.length === 0) {
        process.stdout.write("No sessions found. Use 'agentcost session start' first.\n");
        return;
      }
      if (options.json) {
        process.stdout.write(JSON.stringify({ sessions: statuses }) + "\n");
        return;
      }
      process.stdout.write(renderSessionStatus(statuses) + "\n");
    });

  session
    .command("reset")
    .description("Remove the kill-switch block from a session")
    .requiredOption("--id <id>", "session id")
    .action((options: { id: string }) => {
      const session = unblockSession(options.id);
      if (!session) {
        process.stderr.write(`Session '${options.id}' not found.\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`Session ${session.id} unblocked.\n`);
    });
}

export function attachCheckCommand(program: Command): void {
  program
    .command("check")
    .description("Human- or agent-readable session spending status")
    .option("--session <id>", "session id to check")
    .option("--json", "output machine-readable JSON")
    .option("--exit-if-over", "exit 1 when the session is over its limit")
    .option("--kill", "open the kill switch (block the session) when over its limit")
    .action(async (options: {
      session?: string;
      json?: boolean;
      exitIfOver?: boolean;
      kill?: boolean;
    }) => {
      const id = options.session;
      if (id === undefined) {
        process.stderr.write("Provide a session id: agentcost check --session <id>.\n");
        process.exitCode = 1;
        return;
      }
      const sessions = loadSessions();
      const session = sessions.find((s) => s.id === id);
      if (!session) {
        process.stderr.write(`Session '${id}' not found.\n`);
        process.exitCode = 1;
        return;
      }
      const { evaluateAlertsForThresholds } = await import("./alerts");
      const status = sessionStatus(sessions, loadStore(), id)[0];
      if (status.blocked) {
        const blockedPayload = {
          session: status,
          ok: false,
          reason: "session blocked by kill switch",
        };
        if (options.json) {
          process.stdout.write(JSON.stringify(blockedPayload) + "\n");
        } else {
          process.stdout.write(renderCheckStatus(status) + "\n");
        }
        process.exitCode = 1;
        return;
      }
      if (status.percent >= 80 || status.percent >= 100) {
        await evaluateAlertsForThresholds([
          {
            name: status.id,
            limit: status.limit,
            spent: status.spent,
            percent: status.percent,
            kind: "session",
          },
        ]);
      }
      const over = status.percent >= 100;
      if (over && options.kill) {
        blockSession(id);
        status.blocked = true;
      }
      const payload = {
        session: status,
        ok: !over && !status.blocked,
        reason: over ? "session over limit" : "within limit",
      };
      if (options.json) {
        process.stdout.write(JSON.stringify(payload) + "\n");
      } else {
        process.stdout.write(renderCheckStatus(status) + "\n");
      }
      if ((over && options.exitIfOver) || status.blocked) {
        process.exitCode = 1;
      }
    });
}