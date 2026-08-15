import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";
import type { Command } from "commander";
import { SKILL_MARKDOWN } from "./skill-markdown";

export const DEFAULT_SKILL_DIR = join(homedir(), ".agents", "skills", "agentcost");

export function resolveSkillDir(explicitDir?: string): string {
  if (explicitDir !== undefined && explicitDir.length > 0) return explicitDir;
  return DEFAULT_SKILL_DIR;
}

export function installSkill(dir: string): { dir: string; file: string } {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  writeFileSync(file, SKILL_MARKDOWN, "utf8");
  return { dir, file };
}

export function skillInstalled(dir: string): boolean {
  return existsSync(join(dir, "SKILL.md"));
}

export function attachSkillCommand(program: Command): void {
  const skill = program
    .command("skill")
    .description("Install the agentcost skill so any AI agent can self-manage its LLM costs");

  skill
    .command("install")
    .description("Install the skill into an agent skills directory")
    .option(
      "--dir <path>",
      `target skills directory (default: ${DEFAULT_SKILL_DIR})`,
    )
    .action((options: { dir?: string }) => {
      const target = resolveSkillDir(options.dir);
      const result = installSkill(target);
      process.stdout.write(
        `agentcost skill installed at ${pc.green(result.file)}\n`,
      );
      process.stdout.write(
        "Any AI agent reading that directory can now use check/route/session to self-limit.\n",
      );
      process.stdout.write(
        "Other platforms: run again with --dir to target e.g. ~/.claude/skills/agentcost.\n",
      );
    });

  skill
    .command("show")
    .description("Print the skill markdown (ready to paste or review)")
    .action(() => {
      process.stdout.write(SKILL_MARKDOWN);
    });
}