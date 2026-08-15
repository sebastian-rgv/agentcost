import { Command } from "commander";
import { attachEstimateCommand } from "./estimate";
import { attachTrackCommand } from "./track";
import { attachModelsCommand } from "./models";
import { attachTokensCommand } from "./tokens";
import { attachPricingCommand } from "./pricing";
import { attachReportCommand } from "./report";
import { attachBudgetCommand } from "./budget";
import { attachWatchCommand } from "./watch";
import { attachLiveCommand } from "./live";
import { attachSessionCommand, attachCheckCommand } from "./session";
import { attachRouteCommand, attachPolicyCommand } from "./route";
import { attachOptimizeCommand } from "./optimize";
import { attachAlertsCommand } from "./alerts";
import { attachServerCommand } from "./server";

export const VERSION = "1.2.0";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("agentcost")
    .description("Estimate, track, route and gate AI agent (LLM) costs")
    .version(VERSION);
  attachEstimateCommand(program);
  attachTrackCommand(program);
  attachModelsCommand(program);
  attachTokensCommand(program);
  attachPricingCommand(program);
  attachReportCommand(program);
  attachBudgetCommand(program);
  attachWatchCommand(program);
  attachLiveCommand(program);
  attachSessionCommand(program);
  attachCheckCommand(program);
  attachRouteCommand(program);
  attachPolicyCommand(program);
  attachOptimizeCommand(program);
  attachAlertsCommand(program);
  attachServerCommand(program);
  return program;
}

export function run(argv: string[]): void {
  buildProgram().parse(argv);
}