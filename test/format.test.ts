import { describe, expect, it } from "vitest";
import { isSupportedLogExtension, parseLogFormat } from "../src/format";

describe("parseLogFormat", () => {
  it("defaults to auto", () => {
    expect(parseLogFormat(undefined)).toBe("auto");
  });

  it("accepts auto, openai and anthropic case-insensitively", () => {
    expect(parseLogFormat("OPENAI")).toBe("openai");
    expect(parseLogFormat("Anthropic")).toBe("anthropic");
    expect(parseLogFormat("auto")).toBe("auto");
  });

  it("rejects unknown formats", () => {
    expect(parseLogFormat("csv")).toBeNull();
    expect(parseLogFormat("")).toBeNull();
  });
});

describe("isSupportedLogExtension", () => {
  it("accepts .jsonl, .ndjson and .log", () => {
    expect(isSupportedLogExtension("usage.jsonl")).toBe(true);
    expect(isSupportedLogExtension("usage.ndjson")).toBe(true);
    expect(isSupportedLogExtension("usage.log")).toBe(true);
    expect(isSupportedLogExtension("usage.JSONL")).toBe(true);
  });

  it("rejects other extensions", () => {
    expect(isSupportedLogExtension("usage.txt")).toBe(false);
    expect(isSupportedLogExtension("usage")).toBe(false);
  });
});