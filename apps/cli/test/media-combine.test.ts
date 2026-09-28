import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { combineArgs, defaultCombinePath } from "../src/media/combine";

describe("combineArgs", () => {
  it("muxes video + audio with stream-copy video and AAC 320k (combine.sh)", () => {
    const args = combineArgs("raw_silent.mp4", "raw_enhanced.mp3", "raw_combined.mp4");
    expect(args).toEqual([
      "-y",
      "-i", "raw_silent.mp4",
      "-i", "raw_enhanced.mp3",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "320k",
      "-avoid_negative_ts", "make_zero",
      "-movflags", "+faststart",
      "-shortest",
      "raw_combined.mp4",
    ]);
  });

  it("omits faststart for non-mp4/m4v/mov output", () => {
    const args = combineArgs("s.mkv", "a.mp3", "out.mkv");
    expect(args).not.toContain("-movflags");
    expect(args.at(-1)).toBe("out.mkv");
  });
});

describe("defaultCombinePath", () => {
  it("strips a trailing _silent so raw_silent + audio → raw_combined", () => {
    expect(defaultCombinePath(join("v", "raw_silent.mp4"))).toBe(
      join("v", "raw_combined.mp4"),
    );
  });

  it("strips a trailing _combined (re-combine) and leaves other names alone", () => {
    expect(defaultCombinePath(join("v", "raw_combined.mp4"))).toBe(
      join("v", "raw_combined.mp4"),
    );
    expect(defaultCombinePath(join("v", "raw.mp4"))).toBe(join("v", "raw_combined.mp4"));
    expect(defaultCombinePath(join("v", "my_silent_take.mp4"))).toBe(
      join("v", "my_silent_take_combined.mp4"),
    );
  });
});
