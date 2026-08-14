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

export const VERSION = "1.1.0";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("agentcost")
    .description("Estimate and track AI agent (LLM) costs")
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
  return program;
}

export function run(argv: string[]): void {
  buildProgram().parse(argv);
}