import { describe, expect, it } from "vitest";
import {
  AUDIO_ENHANCE_PRESETS,
  AudioEnhancePresetSchema,
  audioMasterFilter,
  loudnormArgs,
} from "../src/index";

describe("AudioEnhancePresetSchema", () => {
  it("accepts canonical presets", () => {
    expect(AUDIO_ENHANCE_PRESETS).toEqual(["off", "clean", "studio"]);
    expect(AudioEnhancePresetSchema.parse("off")).toBe("off");
    expect(AudioEnhancePresetSchema.parse("clean")).toBe("clean");
    expect(AudioEnhancePresetSchema.parse("studio")).toBe("studio");
  });

  it("rejects invalid presets", () => {
    expect(AudioEnhancePresetSchema.safeParse("unknown").success).toBe(false);
    expect(AudioEnhancePresetSchema.safeParse("").success).toBe(false);
    expect(AudioEnhancePresetSchema.safeParse(null).success).toBe(false);
  });
});

describe("audioMasterFilter", () => {
  it("defaults to EBU R128 loudnorm when enhance is unset or off", () => {
    expect(audioMasterFilter()).toBe("loudnorm=I=-16:TP=-1.5:LRA=11");
    expect(audioMasterFilter("off")).toBe("loudnorm=I=-16:TP=-1.5:LRA=11");
  });

  it("clean preset applies highpass (80 Hz) and afftdn before loudnorm", () => {
    expect(audioMasterFilter("clean")).toBe(
      "highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11",
    );
  });

  it("studio preset applies highpass, afftdn, deesser, and presence boost before loudnorm", () => {
    expect(audioMasterFilter("studio")).toBe(
      "highpass=f=80,afftdn=nf=-25,deesser,treble=g=2:f=3000,loudnorm=I=-16:TP=-1.5:LRA=11",
    );
  });
});

describe("loudnormArgs", () => {
  it("assembles exact ffmpeg arguments with video copied untouched", () => {
    expect(loudnormArgs("/in.mp4", "/out.mp4", { enhance: "clean" })).toEqual([
      "-y",
      "-i",
      "/in.mp4",
      "-c:v",
      "copy",
      "-af",
      "highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "/out.mp4",
    ]);
  });
});
