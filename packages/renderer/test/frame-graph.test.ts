import { describe, expect, it } from "vitest";
import { buildFfmpegFilterGraph, buildFfmpegRenderArgs, type FrameGraphSpec } from "../src/ffmpeg-renderer";

const base = { width: 1080, height: 1920 };

const allLayers = (): FrameGraphSpec => ({
  geometry: { content: { x: 65, y: 115, width: 950, height: 1690 }, radius: 24 },
  background: "/pub/frame/background.png",
  mask: "/pub/frame/mask.png",
  shadow: "/pub/frame/shadow.png",
  border: "/pub/frame/border.png",
});

describe("frame styling — ABSENT means off", () => {
  it("builds the pre-feature graph and no extra inputs", () => {
    const g = buildFfmpegFilterGraph(base);
    expect(g.frameInputs).toEqual([]);
    expect(g.filterComplex).not.toContain("alphamerge");
    expect(g.filterComplex).not.toContain("[1:v]");
    expect(g.videoOutLabel).toBe("[vout]");
    // With no frame there is no configured background to fall through to, so
    // the fitted picture still lands on an opaque `pad` — the exact graph this
    // always built, which is what keeps such a run byte-identical.
    expect(g.filterComplex).toContain(
      "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[vout]",
    );
    // No backdrop machinery: nothing is blurred, nothing is split.
    expect(g.filterComplex).not.toContain("gblur");
    expect(g.filterComplex).not.toContain("split=2");
  });

  it("declares no `-framerate` for a run with nothing to declare", () => {
    const args = buildFfmpegRenderArgs({
      inputVideo: "in.mp4",
      filterScriptPath: "f.txt",
      audioOutLabel: "[0:a]",
      outPath: "o.mp4",
      frameInputs: [],
      fps: 30,
    });
    expect(args).not.toContain("-framerate");
  });
});

describe("frame styling — graph wiring", () => {
  it("names inputs 1..4 in the order frameInputs carries them", () => {
    const g = buildFfmpegFilterGraph({ ...base, frame: allLayers() });
    expect(g.frameInputs).toEqual([
      "/pub/frame/background.png",
      "/pub/frame/mask.png",
      "/pub/frame/shadow.png",
      "/pub/frame/border.png",
    ]);
    // Positional: the graph MUST agree with that order or every layer lands
    // on the wrong input (the -22 Invalid argument a mismatched order gave).
    expect(g.filterComplex).toContain("[1:v]format=rgba[bgbase]");
    expect(g.filterComplex).toContain("[3:v]overlay=0:0[bged]");
    expect(g.filterComplex).toContain("[4:v]overlay=0:0[bordered]");
    // The background feeds the SHADOW overlay, not the picture: a shadow that
    // composited over the video would darken the frame itself.
    expect(g.filterComplex).toContain("[bgbase][3:v]overlay=0:0[bged]");
  });

  it("fits the picture and lets the gaps fall through to the background", () => {
    const g = buildFfmpegFilterGraph({ ...base, frame: allLayers() });
    // The picture is FITTED (decrease = contain) into the content box: a
    // 1280x1024 source shows whole, never reflowed to the output's aspect.
    expect(g.filterComplex).toContain(
      "[0:v]scale=950:1690:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1,format=rgba[vpic]",
    );
    // …and it is NOT padded. The gap it leaves shows a CROP of the frame's own
    // background, so the wallpaper/image/colour runs unbroken behind the
    // picture instead of stopping at a black bar.
    expect(g.filterComplex).not.toContain("pad=");
    expect(g.filterComplex).not.toContain("gblur");
    // `format=rgba` guards the crop: the shadow overlay leaves the background
    // as yuva420p, and crop rounds an ODD box width to the chroma boundary
    // (1215 -> 1214) — one pixel off the mask, which alphamerge then rejects.
    expect(g.filterComplex).toContain("[bgbox]format=rgba,crop=950:1690:65:115[bginner]");
    expect(g.filterComplex).toContain("[bginner][vpic]overlay=(W-w)/2:(H-h)/2[vbox]");
    // The box is clipped to the rounded mask at content size, so the corners
    // fall through to the same background the ring already shows.
    expect(g.filterComplex).toContain("[vbox][2:v]alphamerge[boxed]");
    // Placed at the content box's own offset, not at 0,0.
    expect(g.filterComplex).toContain("[bgunder][boxed]overlay=65:115[comp]");
  });

  it("drops alphamerge and the mask input when the corners are square", () => {
    const spec = allLayers();
    spec.mask = undefined;
    const g = buildFfmpegFilterGraph({ ...base, frame: spec });
    expect(g.filterComplex).not.toContain("alphamerge");
    // Inputs renumber: shadow and border move UP into the freed slot.
    expect(g.frameInputs).toEqual([
      "/pub/frame/background.png",
      "/pub/frame/shadow.png",
      "/pub/frame/border.png",
    ]);
    expect(g.filterComplex).toContain("[2:v]overlay=0:0[bged]");
    expect(g.filterComplex).toContain("[3:v]overlay=0:0[bordered]");
    // The gaps still fall through to the background without a clip step.
    expect(g.filterComplex).toContain("[bgunder][vbox]overlay=65:115[comp]");
    expect(g.filterComplex).not.toContain("pad=");
  });

  it("burns captions AFTER the frame, in full-frame coordinates", () => {
    // generateAssSubtitles sizes against the OUTPUT, so shifting the burn
    // into the padded box would move every caption the moment padding turned
    // on. The ass filter therefore runs on the composed frame.
    const g = buildFfmpegFilterGraph({ ...base, frame: allLayers(), assPath: "/pub/subs.ass" });
    expect(g.filterComplex).toMatch(/\[bordered\]format=yuv420p,setsar=1\[vpre\];\[vpre\]ass='/);
    expect(g.videoOutLabel).toBe("[vout]");
  });

  it("composes in order: background, picture, stroke", () => {
    const g = buildFfmpegFilterGraph({ ...base, frame: allLayers() });
    const f = g.filterComplex;
    const i = (s: string) => f.indexOf(s);
    expect(i("[bgbase]")).toBeGreaterThan(-1);
    expect(i("[bgunder][boxed]overlay")).toBeGreaterThan(i("[bgbase]"));
    expect(i("[4:v]overlay=0:0[bordered]")).toBeGreaterThan(i("[bgunder][boxed]overlay"));
    expect(i("[vout]")).toBeGreaterThan(i("[4:v]overlay=0:0[bordered]"));
  });
});

describe("buildFfmpegRenderArgs — frame inputs", () => {
  it("passes each static PNG at the OUTPUT rate, after input 0", () => {
    // A static image without -framerate silently declares 25fps, and an
    // overlay taking it as MAIN adopts that rate — re-timing the whole video.
    // Paths are `resolve()`d, so assert on the SHAPE rather than the strings.
    const args = buildFfmpegRenderArgs({
      inputVideo: "in.mp4",
      filterScriptPath: "f.txt",
      audioOutLabel: "[0:a]",
      outPath: "o.mp4",
      frameInputs: ["/a/bg.png", "/a/mask.png"],
      fps: 24,
    });
    const firstVideo = args.indexOf("-i");
    const firstRate = args.indexOf("-framerate");
    expect(firstRate).toBeGreaterThan(firstVideo);
    expect(args.filter((a) => a === "-framerate")).toHaveLength(2);

    for (let i = 0; i < args.length; i++) {
      if (args[i] !== "-framerate") continue;
      expect(args[i + 1]).toBe("24");
      expect(args[i + 2]).toBe("-i");
      expect(i).toBeGreaterThan(firstVideo);
    }
  });
});
