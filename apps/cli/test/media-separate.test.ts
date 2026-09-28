import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { defaultSeparatePaths, separateArgs } from "../src/media/separate";

describe("separateArgs", () => {
  it("stream-copies video without audio and re-encodes audio to 320k mp3", () => {
    const { videoArgs, audioArgs } = separateArgs(
      "in/raw.mp4",
      "out/raw_silent.mp4",
      "out/raw_audio.mp3",
    );
    expect(videoArgs).toEqual([
      "-y", "-i", "in/raw.mp4",
      "-map", "0:v:0",
      "-c:v", "copy",
      "-an",
      "-avoid_negative_ts", "make_zero",
      "-movflags", "+faststart",
      "out/raw_silent.mp4",
    ]);
    expect(audioArgs).toEqual([
      "-y", "-i", "in/raw.mp4",
      "-vn",
      "-b:a", "320k",
      "out/raw_audio.mp3",
    ]);
  });

  it("adds faststart only for mp4/m4v/mov silent output", () => {
    const mkv = separateArgs("in.mkv", "out/s.mkv", "out/a.mp3");
    expect(mkv.videoArgs).not.toContain("-movflags");

    const mov = separateArgs("in.mov", "out/s.mov", "out/a.mp3");
    expect(mov.videoArgs).toContain("+faststart");

    const m4v = separateArgs("in.m4v", "out/s.m4v", "out/a.mp3");
    expect(m4v.videoArgs).toContain("+faststart");
  });
});

describe("defaultSeparatePaths", () => {
  it("derives _silent and _audio.mp3 next to the source (separate.sh naming)", () => {
    const p = defaultSeparatePaths(join("clips", "take.mov"));
    expect(p.silent).toBe(join("clips", "take_silent.mov"));
    expect(p.audio).toBe(join("clips", "take_audio.mp3"));
  });
});
