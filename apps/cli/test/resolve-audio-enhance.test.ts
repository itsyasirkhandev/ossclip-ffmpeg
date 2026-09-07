import { describe, expect, it } from "vitest";
import { resolveAudioEnhance } from "../src/produce";

describe("resolveAudioEnhance", () => {
  it("typed flag beats config setting", () => {
    expect(resolveAudioEnhance("clean", "studio")).toEqual({ enhance: "clean" });
    expect(resolveAudioEnhance("off", "clean")).toEqual({ enhance: "off" });
    expect(resolveAudioEnhance("studio", undefined)).toEqual({ enhance: "studio" });
  });

  it("config setting takes effect when flag is undefined", () => {
    expect(resolveAudioEnhance(undefined, "clean")).toEqual({ enhance: "clean" });
    expect(resolveAudioEnhance(undefined, "studio")).toEqual({ enhance: "studio" });
    expect(resolveAudioEnhance(undefined, "off")).toEqual({ enhance: "off" });
  });

  it("defaults to off when both flag and config are undefined", () => {
    expect(resolveAudioEnhance(undefined, undefined)).toEqual({ enhance: "off" });
  });

  it("warns and falls back to off for malformed config", () => {
    const result = resolveAudioEnhance(undefined, "invalid-preset");
    expect(result.enhance).toBe("off");
    expect(result.warning).toContain("config audioEnhance ignored");
  });
});
