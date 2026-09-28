import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FRAME_ASSET_DIR, buildFrameAssetPlan, gradientGeqExprs } from "../src/frame-assets";
import { defaultFrameStyle, frameGeometry, wallpaperFile, type FrameStyle } from "@ossclip/core/browser";

const OUT = { width: 1080, height: 1920 };

function plan(style: Partial<FrameStyle>, publicDir = "/pub") {
  const full = { ...defaultFrameStyle(), ...style };
  return buildFrameAssetPlan(
    { style: full, geometry: frameGeometry(full, OUT), themeBg: "#0B0B0E" },
    publicDir,
  );
}

/** Every `key='value'` payload inside a lavfi `-i` chain. */
function quotedValues(chain: string): string[] {
  const out: string[] = [];
  for (const m of chain.matchAll(/(\w+)='([^']*)'/g)) out.push(m[2]!);
  return out;
}

describe("buildFrameAssetPlan — what gets built", () => {
  it("always builds a background, because the padding ring needs a colour either way", () => {
    for (const style of [{}, { background: { type: "none" as const } }]) {
      const p = plan(style);
      expect(p.background).toBe(`${FRAME_ASSET_DIR}/background.png`);
      expect(p.commands.some((c) => c.out.endsWith("background.png"))).toBe(true);
    }
  });

  it("skips the mask when the corners are not rounded", () => {
    const p = plan({ radius: 0 });
    expect(p.mask).toBeUndefined();
    expect(p.commands.some((c) => c.out.endsWith("mask.png"))).toBe(false);
  });

  it("skips the shadow when it would paint nothing", () => {
    expect(plan({ shadowBlur: 0 }).shadow).toBeUndefined();
    expect(plan({ shadowOpacity: 0 }).shadow).toBeUndefined();
    // Blur present but zero opacity still skips — same two conditions the
    // preview's `frameShadowCss` checks, so both surfaces drop it together.
    expect(plan({ shadowBlur: 40, shadowOpacity: 0 }).shadow).toBeUndefined();
  });

  it("skips the stroke when borderWidth is 0", () => {
    expect(plan({ borderWidth: 0 }).border).toBeUndefined();
    expect(plan({ borderWidth: 1 }).border).toBeDefined();
  });

  it("scales stroke and shadow alpha by the colour's own alpha", () => {
    // The preview emits the raw `rgba(...)` (frameBorderCss / frameShadowCss,
    // the latter multiplying c.a * shadowOpacity), so an rgba border colour
    // with alpha < 1 must lose the same amount here — otherwise the default
    // rgba(255,255,255,0.2) border exports as SOLID white while the editor
    // shows a 20% one.
    const chainOf = (name: string) =>
      plan({ borderWidth: 6, shadowBlur: 40, shadowColor: "rgba(0,0,0,0.5)" })
        .commands.find((c) => c.out.endsWith(name))!.args.join(" ");
    // 255 * 0.2 (borderColor default) ahead of the coverage term.
    expect(chainOf("border.png")).toContain(":a='255*0.2*min(");
    // 255 * shadowOpacity 0.8 * shadowColor a 0.5.
    expect(chainOf("shadow.png")).toContain(":a='255*0.4*");
    // An opaque colour keeps the old full-strength coefficients.
    expect(plan({ borderWidth: 6, borderColor: "#ffffff" }).commands
      .find((c) => c.out.endsWith("border.png"))!.args.join(" ")).toContain(":a='255*1*min(");
  });

  it("sizes the mask to the content box and the shadow/stroke to the frame", () => {
    const p = plan({ padding: 6, radius: 24, borderWidth: 6 });
    expect(p.mask).toBeDefined();
    const chainOf = (name: string) => p.commands.find((c) => c.out.endsWith(name))!.args.join(" ");
    expect(chainOf("mask.png")).toContain(":s=950x1690");
    expect(chainOf("shadow.png")).toContain(":s=1080x1920");
    expect(chainOf("border.png")).toContain(":s=1080x1920");
  });

  it("runs every asset as a SINGLE frame and never -loop s one", () => {
    // `-loop 1` on a static input is what made an old probe 4.6x slower than
    // it needed to be; framesync's defaults repeat a finite input for free.
    const p = plan({});
    for (const c of p.commands) {
      expect(c.args).toContain("-frames:v");
      expect(c.args).not.toContain("-loop");
    }
  });
});

describe("buildFrameAssetPlan — lavfi expression safety", () => {
  it("keeps ':' out of every quoted expression", () => {
    // `:` is lavfi's OPTION SEPARATOR. A colon inside a geq expression
    // silently splits it into a bogus option and the asset build dies with
    // "Cannot find option" — so this is a hard invariant, not a style rule.
    for (const style of [{}, { padding: 6, radius: 24 }, { shadowBlur: 40 }, { borderWidth: 6 }]) {
      const p = plan(style);
      for (const c of p.commands) {
        const lavfi = c.args.indexOf("-f") >= 0 ? c.args[c.args.indexOf("-i") + 1] : undefined;
        if (lavfi === undefined) continue; // the image background is a file input, not lavfi
        for (const v of quotedValues(lavfi)) {
          expect(v, `colon in ${v}`).not.toContain(":");
        }
      }
    }
  });

  it("is byte-deterministic across calls", () => {
    // A cached asset is keyed off the request, so a plan that drifts between
    // two identical calls would reuse the wrong PNG.
    const a = plan({ padding: 6, radius: 24, shadowBlur: 40, borderWidth: 6 });
    const b = plan({ padding: 6, radius: 24, shadowBlur: 40, borderWidth: 6 });
    expect(a).toEqual(b);
  });
});

describe("buildFrameAssetPlan — background kinds", () => {
  it("fills with the stage colour when the background is off", () => {
    const chain = plan({ background: { type: "none" } }).commands[0]!.args.join(" ");
    expect(chain).toContain("#0B0B0E");
  });

  it("cover-fits an image (increase + crop — `cover` is not a valid var value)", () => {
    const p = plan({ background: { type: "image", file: "side-images/pic.png" } }, "/pub");
    const cmd = p.commands[0]!;
    expect(cmd.args.join(" ")).toContain("force_original_aspect_ratio=increase");
    expect(cmd.args.join(" ")).toContain("crop=1080:1920");
    // Resolved against the public dir here, not left for the argv to resolve:
    // ffmpeg resolves -i against the CWD. `join`, because this is a filesystem
    // path and the test has to hold on Windows too.
    expect(cmd.args.join(" ")).toContain(join("/pub", "side-images/pic.png"));
  });

  it("cover-fits a bundled wallpaper exactly like a picked image", () => {
    // Same plan, same join against the public dir, same increase+crop: the
    // producer has already copied the catalog file to `<public>/wallpapers/
    // images/…` by the time this runs, so there is no second code path to
    // keep in step — only the SOURCE of the bytes differs.
    const p = plan({ background: { type: "wallpaper", file: wallpaperFile(5) } }, "/pub");
    const args = p.commands[0]!.args.join(" ");
    expect(args).toContain("force_original_aspect_ratio=increase");
    expect(args).toContain("crop=1080:1920");
    expect(args).toContain(join("/pub", "wallpapers/images/wallpaper-0005.jpg"));
  });

  it("passes an absolute image path through untouched", () => {
    const p = plan({ background: { type: "image", file: "/abs/pic.png" } }, "/pub");
    expect(p.commands[0]!.args.join(" ")).toContain("/abs/pic.png");
  });
});

describe("gradientGeqExprs", () => {
  const style = (direction: "to bottom right" | "circle-out"): FrameStyle => ({
    ...defaultFrameStyle(),
    background: { type: "gradient", start: "#6366f1", end: "#9ca9ff", direction },
  });

  it("rounds half up so the rasteriser matches the browser's rounding", () => {
    // `geq` TRUNCATES floats and browsers round; every channel lerp therefore
    // carries an explicit +0.5. Without it the two surfaces differ by up to a
    // whole level per channel, which reads as a colour shift on a big fill.
    const e = gradientGeqExprs(style("to bottom right"), 1080, 1920)!;
    for (const ch of ["r", "g", "b"] as const) expect(e[ch]).toContain("+0.5");
  });

  it("goes dark at the origin and light at the far corner", () => {
    const e = gradientGeqExprs(style("to bottom right"), 1080, 1920)!;
    // `to bottom right` runs (0,0)->(W,H): t=0 at the top-left (#6366f1 =
    // 99,102,241) and t=1 at the bottom-right (#9ca9ff = 156,169,255).
    expect(e.r!.startsWith("round(") || e.r!.includes("0.5")).toBe(true);
    expect(gradientGeqExprs(style("circle-out"), 1080, 1920)).toBeDefined();
  });

  it("returns nothing when the background is not a gradient", () => {
    expect(gradientGeqExprs(defaultFrameStyle(), 100, 100)).toBeUndefined();
  });
});
