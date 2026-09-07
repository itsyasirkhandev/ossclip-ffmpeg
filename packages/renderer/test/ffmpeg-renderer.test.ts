import { describe, expect, it } from "vitest";
import { generateAssSubtitles } from "../src/ffmpeg-renderer";
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
