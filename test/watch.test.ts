import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { scanCallsInDir } from "../src/watch";

describe("scanCallsInDir", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentcost-watch-"));
    file = join(dir, "usage.ndjson");
    writeFileSync(
      file,
      JSON.stringify({
        model: "gpt-4o",
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      }) + "\n",
      "utf8",
    );
  });

  it("captures a new file once and does not re-process it", () => {
    const first = scanCallsInDir(dir);
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0].model).toBe("gpt-4o");
    expect(first.calls[0].cost).toBeCloseTo(0.0075, 10);
    expect(first.nextState[file]).toEqual({ hash: expect.any(String), offset: expect.any(Number) });

    const second = scanCallsInDir(dir, first.nextState);
    expect(second.calls).toHaveLength(0);
  });

  it("processes only appended content", () => {
    const first = scanCallsInDir(dir);
    appendFileSync(
      file,
      "\n" + JSON.stringify({
        model: "gpt-4o-mini",
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
      "utf8",
    );
    const second = scanCallsInDir(dir, first.nextState);
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0].model).toBe("gpt-4o-mini");
  });

  it("tracks multiple files in a directory", () => {
    const other = join(dir, "more.jsonl");
    writeFileSync(
      other,
      JSON.stringify({
        model: "claude-3-5-sonnet",
        usage: { input_tokens: 100, output_tokens: 50 },
      }) + "\n",
      "utf8",
    );
    const result = scanCallsInDir(dir);
    expect(result.calls).toHaveLength(2);
  });

  it("ignores files without a supported extension", () => {
    const notes = join(dir, "notes.txt");
    writeFileSync(notes, "{\"model\":\"gpt-4o\",\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1}}\n", "utf8");
    const result = scanCallsInDir(dir);
    expect(result.nextState[notes]).toBeUndefined();
    expect(result.calls).toHaveLength(1);
  });
});