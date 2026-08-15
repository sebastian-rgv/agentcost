// Regenerates src/skill-markdown.ts from skills/agentcost/SKILL.md
// Run: npm run skill:build
import { readFileSync, writeFileSync } from "node:fs";

const source = "skills/agentcost/SKILL.md";
const target = "src/skill-markdown.ts";
const markdown = readFileSync(source, "utf8");
const output =
  "// AUTO-GENERATED from " + source + ". Do not edit by hand.\n" +
  "// Regenerate with: npm run skill:build\n" +
  "export const SKILL_MARKDOWN = " + JSON.stringify(markdown) + ";\n";
writeFileSync(target, output, "utf8");
console.log("generated " + target + " (" + output.length + " bytes)");