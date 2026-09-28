import { describe, expect, it } from "vitest";
import {
  BackgroundSchema,
  FRAME_STYLE_DEFAULTS,
  FrameStyleSchema,
  WALLPAPER_COUNT,
  defaultFrameStyle,
  frameBackgroundCss,
  frameBorderCss,
  frameGeometry,
  frameShadowCss,
  frameStyleEnabled,
  gradientGeometry,
  parseCssColor,
  wallpaperFile,
  wallpaperIndex,
  wallpaperThumb,
} from "../src/frame-style";

const OUT = { width: 1080, height: 1920 };

describe("FrameStyle schema", () => {
  it("parses an absent feature to ScreenArc's shipped look", () => {
    // `{}` is what the editor writes for "first edit": every control seeds to
    // its ScreenArc default rather than to an off state.
    expect(FrameStyleSchema.parse({})).toEqual({
      background: { type: "none" },
      ...FRAME_STYLE_DEFAULTS,
    });
    expect(defaultFrameStyle()).toEqual(FrameStyleSchema.parse({}));
  });

  it("reports presence, not truthiness — an all-defaults object is ON", () => {
    // The `type: "none"` background means "no background", NOT "feature off":
    // padding/radius/shadow/border are still live behind it.
    expect(frameStyleEnabled(undefined)).toBe(false);
    expect(frameStyleEnabled(defaultFrameStyle())).toBe(true);
  });

  it("refuses an out-of-range value instead of clamping it", () => {
    // Parse-never-coerce: a hand-edited `padding: 99` must fail loudly.
    expect(FrameStyleSchema.safeParse({ padding: 99 }).success).toBe(false);
    expect(FrameStyleSchema.safeParse({ radius: -1 }).success).toBe(false);
    expect(FrameStyleSchema.safeParse({ shadowOpacity: 2 }).success).toBe(false);
  });

  it("rejects a gradient direction that is not one of the ten presets", () => {
    expect(
      FrameStyleSchema.safeParse({ background: { type: "gradient", direction: "diagonal" } }).success,
    ).toBe(false);
  });
});

describe("wallpaper catalog", () => {
  it("names every wallpaper at a served-relative POSIX path", () => {
    // Three readers depend on this exact shape: produce copies the source
    // out of the installed page dir, the preview reads it back as a URL, and
    // `staticFile()` splits only on `/`. A backslash or a leading slash here
    // breaks one of them silently.
    expect(WALLPAPER_COUNT).toBe(17);
    expect(wallpaperFile(1)).toBe("wallpapers/images/wallpaper-0001.jpg");
    expect(wallpaperThumb(17)).toBe("wallpapers/thumbnails/wallpaper-0017.jpg");
    expect(wallpaperFile(1)).not.toMatch(/^[\\/]/);
    expect(wallpaperFile(9)).not.toContain("\\");
  });

  it("indexes a catalog name back to its number and 0 for everything else", () => {
    expect(wallpaperIndex(wallpaperFile(7))).toBe(7);
    expect(wallpaperIndex(wallpaperThumb(1))).toBe(1);
    // A name the catalog does not carry, whatever else it looks like.
    expect(wallpaperIndex("wallpaper-0018.jpg")).toBe(0);
    expect(wallpaperIndex("pic.png")).toBe(0);
    expect(wallpaperIndex("wallpaper-1.jpg")).toBe(0);
    // The suffix match must not be fooled by a traversal PREFIX — the
    // producer never joins this string, but a caller that did would need
    // the index to say no first.
    expect(wallpaperIndex("wallpapers/../../../etc/passwd.jpg")).toBe(0);
  });

  it("parses a wallpaper as its OWN variant, never as a picked image", () => {
    // The two are deliberately distinct: `image` is a file the user pointed
    // at (staged from wherever it lives), `wallpaper` is a catalog entry
    // (staged from inside the package). Fusing them would leave the staging
    // path guessing which of the two it was handed.
    const parsed = BackgroundSchema.parse({ type: "wallpaper", file: wallpaperFile(3) });
    expect(parsed).toEqual({ type: "wallpaper", file: "wallpapers/images/wallpaper-0003.jpg" });
    expect(BackgroundSchema.safeParse({ type: "wallpaper" }).success).toBe(false);
    expect(BackgroundSchema.safeParse({ type: "image" }).success).toBe(false);
  });

  it("renders a wallpaper through the SAME resolver as a picked image", () => {
    const bg = { type: "wallpaper" as const, file: wallpaperFile(2) };
    expect(frameBackgroundCss(bg, (f) => `/${f}`)).toBe(
      'url("/wallpapers/images/wallpaper-0002.jpg") center / cover no-repeat',
    );
    // A resolver that has nothing to give (no staged file yet) omits the
    // background rather than painting an empty url() — the "no background"
    // the renderer falls back to too.
    expect(frameBackgroundCss(bg, () => undefined)).toBeUndefined();
  });
});

describe("frameGeometry", () => {
  it("insets each axis by its own share of the output", () => {
    // 6% of 1080 is 64.8 and of 1920 is 115.2 — rounded independently, which
    // is why a single `padding` value produces a NON-uniform inset.
    const g = frameGeometry({ ...defaultFrameStyle(), padding: 6, radius: 24 }, OUT);
    expect(g.padX).toBe(65);
    expect(g.padY).toBe(115);
    expect(g.content).toEqual({ x: 65, y: 115, width: 950, height: 1690 });
    expect(g.radius).toBe(24);
  });

  it("clamps the radius to half the smaller content edge", () => {
    // CSS silently shrinks an over-large radius; the geq mask would not, and
    // the two would disagree exactly where the clamp engages.
    const g = frameGeometry({ ...defaultFrameStyle(), padding: 10, radius: 100 }, { width: 100, height: 100 });
    expect(g.content).toEqual({ x: 10, y: 10, width: 80, height: 80 });
    expect(g.radius).toBe(40);
  });

  it("never yields a zero-sized content box", () => {
    const g = frameGeometry({ ...defaultFrameStyle(), padding: 30 }, OUT);
    expect(g.content.width).toBeGreaterThan(0);
    expect(g.content.height).toBeGreaterThan(0);
  });

  it("shrinks to the fitted picture so the chrome lands ON the video", () => {
    // The padded stage is 950x1690 (the OUTPUT's aspect). A 1280x1024 source
    // only fits at 950x760 — it never reaches the stage's top and bottom, so
    // without this the border is drawn 465px above the picture, out in the
    // background where it reads as a stray line rather than a frame.
    const g = frameGeometry({ ...defaultFrameStyle(), padding: 6, radius: 24 }, OUT, {
      width: 1280,
      height: 1024,
    });
    expect(g.content).toEqual({ x: 65, y: 580, width: 950, height: 760 });
    // padX/padY still describe the OUTER inset — only the box the chrome
    // hugs moved, so the background still fills to the padding line.
    expect(g.padX).toBe(65);
    expect(g.padY).toBe(115);
    expect(g.radius).toBe(24);
  });

  it("is a no-op when the source already carries the padded box's aspect", () => {
    // No mismatch, nothing to shrink: the picture already reaches every edge.
    const g = frameGeometry({ ...defaultFrameStyle(), padding: 6 }, OUT, { width: 95, height: 169 });
    expect(g.content).toEqual({ x: 65, y: 115, width: 950, height: 1690 });
  });
});

describe("gradientGeometry", () => {
  it("angles a corner preset PERPENDICULAR to the neighbouring corners", () => {
    // CSS Images 3 §3.1.1: box-dependent, NOT a fixed 45deg. On a portrait
    // box the line is (height, width) normalized, so it runs shallow here.
    const g = gradientGeometry("to bottom right", 1080, 1920);
    expect(g.kind).toBe("linear");
    const lin = g as { x0: number; y0: number; x1: number; y1: number };
    expect(lin.x0).toBeCloseTo(-280.415, 2);
    expect(lin.y0).toBeCloseTo(498.516, 2);
    expect(lin.x1).toBeCloseTo(1360.415, 2);
    expect(lin.y1).toBeCloseTo(1421.484, 2);
    // The spec's testable consequence: a stop at 50% intersects BOTH
    // neighbouring corners (top-right and bottom-left).
    const dx = lin.x1 - lin.x0;
    const dy = lin.y1 - lin.y0;
    const m = Math.hypot(dx, dy);
    const mx = (lin.x0 + lin.x1) / 2;
    const my = (lin.y0 + lin.y1) / 2;
    const neighbours: Array<[number, number]> = [
      [1080, 0],
      [0, 1920],
    ];
    for (const [cx, cy] of neighbours) {
      expect(((cx - mx) * dx + (cy - my) * dy) / m).toBeCloseTo(0, 9);
    }
  });

  it("collapses to 45 degrees only when the box is square", () => {
    const g = gradientGeometry("to bottom right", 100, 100) as { x0: number; y0: number };
    // (height, width) normalized on a square IS the diagonal.
    expect(g.x0).toBeCloseTo(0, 9);
    expect(g.y0).toBeCloseTo(0, 9);
  });

  it("runs an edge preset along that edge", () => {
    expect(gradientGeometry("to right", 100, 50)).toEqual({ kind: "linear", x0: 0, y0: 25, x1: 100, y1: 25 });
    expect(gradientGeometry("to bottom", 100, 50)).toEqual({ kind: "linear", x0: 50, y0: 0, x1: 50, y1: 50 });
  });

  it("sizes a radial preset to the closest side", () => {
    // `circle closest-side` in CSS: on a 100x50 box the radius is 25, not 50.
    expect(gradientGeometry("circle-out", 100, 50)).toEqual({ kind: "radial", cx: 50, cy: 25, radius: 25 });
  });
});

describe("parseCssColor", () => {
  it("accepts the shapes the presets ship with", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#6366f1")).toEqual({ r: 99, g: 102, b: 241, a: 1 });
    expect(parseCssColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColor("rgba(255, 255, 255, 0.2)")).toEqual({ r: 255, g: 255, b: 255, a: 0.2 });
  });

  it("reads an 8-digit hex alpha", () => {
    const c = parseCssColor("#00000080")!;
    expect([c.r, c.g, c.b]).toEqual([0, 0, 0]);
    expect(c.a).toBeCloseTo(0.502, 3);
  });

  it("returns undefined rather than guessing at a bad value", () => {
    // Never coerce: a typo'd colour must fall back visibly, not become black.
    expect(parseCssColor("bluish")).toBeUndefined();
    expect(parseCssColor("#12345")).toBeUndefined();
    expect(parseCssColor("")).toBeUndefined();
  });
});

describe("CSS builders", () => {
  it("omits a background the renderer also omits", () => {
    expect(frameBackgroundCss({ type: "none" })).toBeUndefined();
    expect(frameBackgroundCss({ type: "image", file: "x.png" })).toBeUndefined();
    expect(frameBackgroundCss({ type: "image", file: "x.png" }, () => "https://e/x.png")).toBe(
      'url("https://e/x.png") center / cover no-repeat',
    );
  });

  it("emits the exact gradient the rasteriser draws", () => {
    expect(
      frameBackgroundCss({ type: "gradient", start: "#6366f1", end: "#9ca9ff", direction: "to bottom right" }),
    ).toBe("linear-gradient(to bottom right, #6366f1, #9ca9ff)");
    expect(frameBackgroundCss({ type: "gradient", start: "#a", end: "#b", direction: "circle-out" })).toBe(
      "radial-gradient(circle closest-side at center, #a, #b)",
    );
    // circle-in reverses the stops rather than naming a second direction.
    expect(frameBackgroundCss({ type: "gradient", start: "#a", end: "#b", direction: "circle-in" })).toBe(
      "radial-gradient(circle closest-side at center, #b, #a)",
    );
  });

  it("drops a shadow the rasteriser also skips", () => {
    const base = defaultFrameStyle();
    expect(frameShadowCss({ ...base, shadowBlur: 0 })).toBeUndefined();
    expect(frameShadowCss({ ...base, shadowOpacity: 0 })).toBeUndefined();
    expect(frameShadowCss(base)).toBe("0px 15px 35px rgba(0, 0, 0, 0.8)");
  });

  it("multiplies the shadow colour's own alpha by shadowOpacity", () => {
    const c = parseCssColor("#ff000080")!;
    const css = frameShadowCss({ ...defaultFrameStyle(), shadowColor: "#ff000080" })!;
    expect(css.endsWith(`rgba(255, 0, 0, ${c.a * 0.8})`)).toBe(true);
  });

  it("omits a zero-width border and spells a real one", () => {
    const base = defaultFrameStyle();
    expect(frameBorderCss({ ...base, borderWidth: 0 })).toBeUndefined();
    expect(frameBorderCss(base)).toBe("4px solid rgba(255, 255, 255, 0.2)");
  });
});
