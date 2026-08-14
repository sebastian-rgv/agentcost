import { describe, expect, it } from "vitest";
import { countTokens, resolveEncoding } from "../src/tokens";

describe("countTokens", () => {
  it("counts a known phrase with gpt-4o using o200k_base", () => {
    const result = countTokens("Hello world", "gpt-4o");
    expect(result.tokens).toBe(2);
    expect(result.encoding).toBe("o200k_base");
    expect(result.warning).toBeUndefined();
  });

  it("maps claude models to cl100k_base with no warning", () => {
    const resolved = resolveEncoding("claude-3-5-sonnet");
    expect(resolved.encoding).toBe("cl100k_base");
    expect(resolved.warning).toBeUndefined();
  });

  it("maps gpt-4o-mini, gpt-4.1 and o1 to o200k_base", () => {
    for (const model of ["gpt-4o-mini", "gpt-4.1", "o1"]) {
      expect(resolveEncoding(model).encoding).toBe("o200k_base");
    }
  });

  it("falls back to o200k_base with a warning for unknown models", () => {
    const resolved = resolveEncoding("weird-model");
    expect(resolved.encoding).toBe("o200k_base");
    expect(resolved.warning).toBeDefined();

    const result = countTokens("some text here", "weird-model");
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.warning).toBeDefined();
    expect(result.encoding).toBe("o200k_base");
  });

  it("counts unicode characters", () => {
    const result = countTokens("héllo wörld 😀", "gpt-4o");
    expect(result.tokens).toBeGreaterThan(0);
  });

  it("returns zero tokens for empty input", () => {
    const result = countTokens("", "gpt-4o");
    expect(result.tokens).toBe(0);
  });
});