import { describe, expect, it } from "vitest";
import {
  buildFfmpegFilterGraph,
  buildFfmpegRenderArgs,
  generateAssSubtitles,
  parseFfmpegRenderProgress,
} from "../src/ffmpeg-renderer";
import type { CaptionLine } from "@ossclip/core/browser";

describe("ffmpeg-renderer subtitle generation", () => {
  it("generates valid ASS header and dialogue lines with correct time formatting", () => {
    const lines: CaptionLine[] = [
      {
        words: [
          { text: "Hello", start: 0.5, end: 0.9, srcStart: 0.5 },
          { text: "world", start: 1.0, end: 1.5, srcStart: 1.0 },
        ],
        start: 0.5,
        end: 1.5,
      },
      {
        words: [
          { text: "Welcome", start: 2.1, end: 2.6, srcStart: 2.1 },
          { text: "back", start: 2.7, end: 3.2, srcStart: 2.7 },
        ],
        start: 2.1,
        end: 3.2,
      },
    ];

    const ass = generateAssSubtitles(lines, 1920, 1080);
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("Style: Default,Arial");
    expect(ass).toContain("[Events]");
    expect(ass).toContain("{\\c&H004DE1FF&\\fscx112\\fscy112\\b1}Hello{\\r} world");
    expect(ass).toContain("Hello {\\c&H004DE1FF&\\fscx112\\fscy112\\b1}world{\\r}");
    expect(ass).toContain("{\\c&H004DE1FF&\\fscx112\\fscy112\\b1}Welcome{\\r} back");
    expect(ass).toContain("Welcome {\\c&H004DE1FF&\\fscx112\\fscy112\\b1}back{\\r}");
  });

  it("skips empty lines safely", () => {
    const lines: CaptionLine[] = [
      {
        words: [],
        start: 0,
        end: 1,
      },
    ];
    const ass = generateAssSubtitles(lines, 1280, 720);
    expect(ass).not.toContain("Dialogue:");
  });
});

describe("ffmpeg-renderer progress parsing", () => {
  it("parses out_time_us and out_time_ms without 1000x overshoot", () => {
    // ffmpeg outputs out_time_ms in microseconds despite the name (R27 §125 / handoffs).
    // 5_000_000 us = 5 seconds. For a 100s video, this is 5% (0.05), NOT 99%.
    const chunk =
      "frame=120\n" +
      "fps=48.2\n" +
      "out_time_us=5000000\n" +
      "out_time_ms=5000000\n" +
      "out_time=00:00:05.000000\n" +
      "speed=1.53x\n" +
      "progress=continue\n";

    const res = parseFfmpegRenderProgress("", chunk, 100);
    expect(res.carry).toBe("");
    expect(res.progress).toBeCloseTo(0.05, 4);
  });

  it("handles out_time_ms alone as microseconds (ffmpeg quirk)", () => {
    const chunk = "out_time_ms=5000000\n";
    const res = parseFfmpegRenderProgress("", chunk, 100);
    expect(res.progress).toBeCloseTo(0.05, 4);
  });

  it("handles line split across chunk boundaries", () => {
    const part1 = "frame=10\nout_time_us=2000";
    const step1 = parseFfmpegRenderProgress("", part1, 100);
    expect(step1.carry).toBe("out_time_us=2000");
    expect(step1.progress).toBeUndefined();

    const part2 = "000\nout_time_ms=2000000\n";
    const step2 = parseFfmpegRenderProgress(step1.carry, part2, 100);
    expect(step2.carry).toBe("");
    expect(step2.progress).toBeCloseTo(0.02, 4);
  });

  it("parses out_time timecode fallback", () => {
    const chunk = "out_time=00:01:40.000000\n";
    const res = parseFfmpegRenderProgress("", chunk, 200);
    expect(res.progress).toBeCloseTo(0.5, 4);
  });

  it("caps progress at 0.99 while ffmpeg is still running even if outTimeSec exceeds duration", () => {
    const chunk = "out_time_us=105000000\n"; // 105s for 100s video
    const res = parseFfmpegRenderProgress("", chunk, 100);
    expect(res.progress).toBe(0.99);
  });

  it("ignores non-time chunks cleanly without updating progress", () => {
    const chunk = "speed=1.5x\nprogress=continue\n";
    const res = parseFfmpegRenderProgress("", chunk, 100);
    expect(res.carry).toBe("");
    expect(res.progress).toBeUndefined();
  });
});

describe("ffmpeg-renderer filtergraph & argv construction", () => {
  it("builds correct filtergraph and labels without spans", () => {
    const graph = buildFfmpegFilterGraph({
      width: 1920,
      height: 1080,
    });
    expect(graph.audioOutLabel).toBe("[0:a]");
    expect(graph.videoOutLabel).toBe("[vout]");
    expect(graph.filterComplex).toContain("scale=1920:1080");
    expect(graph.filterComplex).toContain("[0:v]");
  });

  it("builds concat chain for 553 cuts without exceeding reasonable structure", () => {
    const spans = Array.from({ length: 553 }, (_, i) => ({
      srcIn: i * 2,
      srcOut: i * 2 + 1,
    }));
    const graph = buildFfmpegFilterGraph({
      spans,
      width: 1920,
      height: 1080,
    });
    expect(graph.audioOutLabel).toBe("[acat]");
    expect(graph.videoOutLabel).toBe("[vout]");
    expect(graph.filterComplex).toContain("[v0]");
    expect(graph.filterComplex).toContain("[v552]");
    expect(graph.filterComplex).toContain("concat=n=553:v=1:a=1[vcat][acat]");
    // 553 spans creates >60KB of filter text, which previously crashed spawn on Windows
    expect(graph.filterComplex.length).toBeGreaterThan(60000);
  });

  it("builds argv using -filter_complex_script to avoid Windows 32KB command line limits", () => {
    const args = buildFfmpegRenderArgs({
      inputVideo: "/path/to/video.mp4",
      filterScriptPath: "/path/to/workdir/filter_complex.txt",
      audioOutLabel: "[acat]",
      outPath: "/path/to/out.mp4",
    });

    expect(args).toContain("-filter_complex_script");
    expect(args).not.toContain("-filter_complex");
    const scriptIndex = args.indexOf("-filter_complex_script");
    expect(args[scriptIndex + 1]).toContain("filter_complex.txt");
    expect(args).toContain("-map");
    expect(args).toContain("[vout]");
    expect(args).toContain("[acat]");
    expect(args).toContain("-preset");
    const presetIndex = args.indexOf("-preset");
    expect(args[presetIndex + 1]).toBe("ultrafast");
    // Command line args remain small (24 entries), immune to spawn ENAMETOOLONG
    expect(args.length).toBe(24);
  });

  it("respects custom preset when provided", () => {
    const args = buildFfmpegRenderArgs({
      inputVideo: "/path/to/video.mp4",
      filterScriptPath: "/path/to/workdir/filter_complex.txt",
      audioOutLabel: "[acat]",
      outPath: "/path/to/out.mp4",
      preset: "veryfast",
    });
    const presetIndex = args.indexOf("-preset");
    expect(args[presetIndex + 1]).toBe("veryfast");
  });
});


