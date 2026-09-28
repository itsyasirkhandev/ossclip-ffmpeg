import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { audioWorkflowOptions, audioWorkflowPaths } from "../src/interactive/audio-workflow";

describe("audioWorkflowOptions", () => {
  it("first extract offers the create-_silent/_audio label", () => {
    const opts = audioWorkflowOptions(true);
    expect(opts).toHaveLength(2);
    expect(opts[0]).toMatchObject({
      value: "extract",
      label: expect.stringContaining("creates _silent.mp4 and _audio.mp3"),
    });
    expect(opts[1]).toMatchObject({ value: "already" });
  });

  it("when outputs already exist, offers re-extract", () => {
    const opts = audioWorkflowOptions(false);
    expect(opts[0]?.label).toContain("Re-extract");
  });
});

describe("audioWorkflowPaths", () => {
  it("derives silent/audio/combined from a raw source", () => {
    const p = audioWorkflowPaths(join("v", "raw.mp4"));
    expect(p.baseName).toBe("raw");
    expect(p.silent).toBe(join("v", "raw_silent.mp4"));
    expect(p.audio).toBe(join("v", "raw_audio.mp3"));
    expect(p.combined).toBe(join("v", "raw_combined.mp4"));
  });

  it("strips _silent so paths do not stack suffixes", () => {
    const p = audioWorkflowPaths(join("v", "raw_silent.mp4"));
    expect(p.baseName).toBe("raw");
    expect(p.silent).toBe(join("v", "raw_silent.mp4"));
    expect(p.combined).toBe(join("v", "raw_combined.mp4"));
  });
});
