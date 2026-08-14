import { Command } from "commander";
import { attachEstimateCommand } from "./estimate";
import { attachTrackCommand } from "./track";
import { attachModelsCommand } from "./models";

export const VERSION = "1.0.0";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("agentcost")
    .description("Estimate and track AI agent (LLM) costs")
    .version(VERSION);
  attachEstimateCommand(program);
  attachTrackCommand(program);
  attachModelsCommand(program);
  return program;
}

export function run(argv: string[]): void {
  buildProgram().parse(argv);
}