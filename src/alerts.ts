import pc from "picocolors";
import type { Command } from "commander";
import { loadAlertConfig, loadAlertState, saveAlertConfig, saveAlertState } from "./store";
import { formatMoney } from "./types";
import type { AlertConfig, AlertEvent } from "./types";

async function postJson(url: string, payload: unknown): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      process.stderr.write(
        `Alert delivery failed (HTTP ${response.status}) to ${url}\n`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Alert delivery failed to ${url}: ${message}\n`);
  }
}

async function sendSlack(webhook: string, text: string): Promise<void> {
  await postJson(webhook, { text });
}

async function sendTelegram(botToken: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await postJson(url, { chat_id: chatId, text });
}

export async function sendAlerts(config: AlertConfig, level: "warning" | "over", event: AlertEvent): Promise<void> {
  const percent = Number.isFinite(event.percent)
    ? `${event.percent.toFixed(1)}%`
    : "over";
  const text = [
    `agentcost ${level.toUpperCase()} alert [${event.kind}]`,
    `${event.name}: spent $${formatMoney(event.spent)} of $${formatMoney(event.limit)} (${percent})`,
  ].join("\n");
  if (config.slackWebhook) {
    await sendSlack(config.slackWebhook, text);
  }
  if (config.telegramBotToken && config.telegramChatId) {
    await sendTelegram(config.telegramBotToken, config.telegramChatId, text);
  }
  if (config.webhook) {
    await postJson(config.webhook, { level, event, text });
  }
}

export async function evaluateAlertsForThresholds(events: AlertEvent[]): Promise<number> {
  const config = loadAlertConfig();
  if (!config || !config.enabled) return 0;
  const state = loadAlertState();
  let fired = 0;
  for (const event of events) {
    const thresholds: Array<"warning" | "over"> =
      event.percent >= 100 ? ["warning", "over"] : ["warning"];
    for (const level of thresholds) {
      const key = `${event.kind}:${event.name}:${level}`;
      if (state[key]) continue;
      await sendAlerts(config, level, event);
      state[key] = { firedAt: new Date().toISOString() };
      fired += 1;
    }
  }
  if (fired > 0) saveAlertState(state);
  return fired;
}

export function hasAlertChannels(config: AlertConfig | null): boolean {
  if (!config) return false;
  return Boolean(config.slackWebhook || (config.telegramBotToken && config.telegramChatId) || config.webhook);
}

export function attachAlertsCommand(program: Command): void {
  const alerts = program
    .command("alerts")
    .description("Configure budget alerts (Slack, Telegram, webhook) and test them");

  alerts
    .command("set")
    .description("Set alert channels (fires at 80% and 100% of a budget or session limit)")
    .option("--slack <url>", "Slack incoming webhook URL")
    .option("--telegram-token <token>", "Telegram bot token")
    .option("--telegram-chat <chatId>", "Telegram chat id")
    .option("--webhook <url>", "generic webhook URL (receives JSON payloads)")
    .option("--disable", "disable alerts without removing the config")
    .action((options: {
      slack?: string;
      telegramToken?: string;
      telegramChat?: string;
      webhook?: string;
      disable?: boolean;
    }) => {
      const existing = loadAlertConfig() ?? {
        enabled: true,
        updatedAt: new Date().toISOString(),
      };
      if (options.slack !== undefined) existing.slackWebhook = options.slack || undefined;
      if (options.telegramToken !== undefined) existing.telegramBotToken = options.telegramToken || undefined;
      if (options.telegramChat !== undefined) existing.telegramChatId = options.telegramChat || undefined;
      if (options.webhook !== undefined) existing.webhook = options.webhook || undefined;
      if (options.disable) existing.enabled = false;
      else existing.enabled = true;
      existing.updatedAt = new Date().toISOString();
      saveAlertConfig(existing);
      process.stdout.write(
        `Alerts ${existing.enabled ? "enabled" : "disabled"}: ` +
          [
            existing.slackWebhook ? "Slack" : undefined,
            existing.telegramBotToken && existing.telegramChatId ? "Telegram" : undefined,
            existing.webhook ? "webhook" : undefined,
          ]
            .filter((channel): channel is string => channel !== undefined)
            .join(", ") + "\n",
      );
    });

  alerts
    .command("list")
    .description("Show the configured alert channels")
    .action(() => {
      const config = loadAlertConfig();
      if (!config) {
        process.stdout.write("No alert channels configured. Use 'agentcost alerts set'.\n");
        return;
      }
      const channels = [
        config.slackWebhook ? "Slack" : undefined,
        config.telegramBotToken && config.telegramChatId ? "Telegram" : undefined,
        config.webhook ? "Webhook" : undefined,
      ]
        .filter((channel): channel is string => channel !== undefined)
        .join(", ");
      process.stdout.write(
        `Alerts ${config.enabled ? "enabled" : "disabled"} (${channels.length > 0 ? channels : "no channels"}).\n`,
      );
    });

  alerts
    .command("clear")
    .description("Reset the fired-threshold state so alerts can fire again")
    .action(() => {
      saveAlertState({});
      process.stdout.write("Alert state cleared.\n");
    });

  alerts
    .command("test")
    .description("Send a test alert through the configured channels")
    .option("--level <level>", "alert level to simulate: warning or over", "warning")
    .action(async (options: { level?: string }) => {
      const config = loadAlertConfig();
      if (!config || !hasAlertChannels(config)) {
        process.stderr.write(
          "No alert channels configured. Use 'agentcost alerts set --slack <url> --webhook <url>'.\n",
        );
        process.exitCode = 1;
        return;
      }
      const level = options.level === "over" ? "over" : "warning";
      await sendAlerts(config, level, {
        name: "test",
        limit: 10,
        spent: level === "over" ? 10 : 8,
        percent: level === "over" ? 100 : 80,
        kind: "session",
      });
      process.stdout.write(`Sent test ${level} alert.\n`);
    });
}

export function alertsUsage(): string {
  return pc.dim("Use 'agentcost alerts set --slack <url> --webhook <url>' to configure channels.");
}