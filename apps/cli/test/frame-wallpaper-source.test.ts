import { isAbsolute, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { frameWallpaperSource } from "../src/produce";
import { wallpaperFile, WALLPAPER_COUNT } from "@ossclip/core";

/**
 * The wallpaper staging decision, extracted so it can be tested without a
 * produce run. Everything dangerous about this feature is in ONE question —
 * "given a string from a hand-editable overrides.json, where do we read
 * bytes from?" — so that question is what is under test here, not the copy.
 */
const PAGE_DIR = "/pkg/editor-dist";

describe("frameWallpaperSource", () => {
  it("resolves every catalog entry inside the page dir", () => {
    for (let n = 1; n <= WALLPAPER_COUNT; n++) {
      const src = frameWallpaperSource(wallpaperFile(n), PAGE_DIR)!;
      expect(src).toBe(join(PAGE_DIR, "wallpapers", "images", `wallpaper-${String(n).padStart(4, "0")}.jpg`));
    }
  });

  it("ignores the stored PREFIX and rebuilds the path from the index", () => {
    // The single most important property: whatever else the string says, the
    // result is a catalog path under pageDir. A value like this is exactly
    // what a hand-edited overrides.json can contain.
    const hostile = "wallpapers/../../../etc/wallpaper-0001.jpg";
    expect(frameWallpaperSource(hostile, PAGE_DIR)).toBe(
      join(PAGE_DIR, "wallpapers", "images", "wallpaper-0001.jpg"),
    );
  });

  it("never returns a path outside the page dir", () => {
    const inputs = [
      "../../../etc/passwd.jpg",
      "wallpapers/../../../etc/wallpaper-0001.jpg",
      wallpaperFile(1),
      wallpaperFile(WALLPAPER_COUNT),
      "wallpaper-0018.jpg",
      "pic.png",
      "",
      "/etc/wallpaper-0001.jpg",
    ];
    for (const input of inputs) {
      const src = frameWallpaperSource(input, PAGE_DIR);
      if (src === undefined) continue;
      const rel = relative(PAGE_DIR, src);
      expect(rel.startsWith("..")).toBe(false);
      expect(isAbsolute(rel)).toBe(false);
      // And no Windows-style escape either, once the separators line up.
      expect(rel.split(sep).some((seg) => seg === "..")).toBe(false);
    }
  });

  it("returns undefined for a name the catalog does not carry", () => {
    expect(frameWallpaperSource("wallpaper-0018.jpg", PAGE_DIR)).toBeUndefined();
    expect(frameWallpaperSource("pic.png", PAGE_DIR)).toBeUndefined();
    expect(frameWallpaperSource("wallpaper-1.jpg", PAGE_DIR)).toBeUndefined();
    expect(frameWallpaperSource("", PAGE_DIR)).toBeUndefined();
  });

  it("returns undefined when there is no page dir to look in", () => {
    // The installed package always has one; a `tsx`-run source tree may not.
    // Falling back to `{type: "none"}` costs the background, not the run.
    expect(frameWallpaperSource(wallpaperFile(1), null)).toBeUndefined();
    expect(frameWallpaperSource(wallpaperFile(1), undefined)).toBeUndefined();
  });
});
