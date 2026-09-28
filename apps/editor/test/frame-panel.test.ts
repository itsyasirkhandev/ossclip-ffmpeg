// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultFrameStyle, defaultTheme, wallpaperFile, type OverrideDoc } from "@ossclip/core/browser";
import { Inspector } from "../src/Inspector";
import { useEdits } from "../src/useEdits";

// The one-time act() opt-in every mounting suite in this repo repeats.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The no-selection view — the ONLY view the Background & frame section
 * renders on. `initialDoc` preloads the doc-global `frameStyle` the same
 * mount-once way Inspector.test.ts's GlobalHarness preloads `captionsHidden`.
 */
function FrameHarness({
  initialDoc,
  onDocChange,
}: {
  initialDoc?: Partial<OverrideDoc>;
  onDocChange?: (doc: OverrideDoc) => void;
}) {
  const edits = useEdits();
  React.useEffect(() => {
    if (initialDoc) {
      edits.load({ theme: {}, scenes: {}, captions: {}, splits: [], cuts: [], ...initialDoc });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    onDocChange?.(edits.doc);
  });
  return React.createElement(Inspector, {
    selection: null,
    cue: null,
    frame: { width: 1080, height: 1920 },
    allSceneIds: ["scene-0"],
    edits,
    onSelect: () => {},
    resolvedTheme: defaultTheme,
    onVideoPreview: vi.fn(),
  });
}

describe("Inspector — Background & frame categories", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const render = async (props: { initialDoc?: Partial<OverrideDoc>; onDocChange?: (d: OverrideDoc) => void }) => {
    await act(async () => {
      root.render(React.createElement(FrameHarness, props));
    });
  };
  const find = (testId: string): HTMLElement | null =>
    container.querySelector(`[data-testid="${testId}"]`);
  const expectOne = (testId: string): HTMLElement => {
    const el = find(testId);
    expect(el, `expected [data-testid="${testId}"]`).not.toBeNull();
    return el!;
  };
  const click = async (testId: string) => {
    const el = expectOne(testId);
    await act(async () => {
      el.click();
    });
  };
  const attr = (testId: string, name: string): string | null =>
    expectOne(testId).getAttribute(name);
  const val = (testId: string): string => (expectOne(testId) as HTMLInputElement).value;

  it("opens Background by default; the other three categories do not exist while the feature is off", async () => {
    await render({});
    expect(attr("frame-card-background-toggle", "aria-expanded")).toBe("true");
    expectOne("frame-off-hint");
    for (const card of ["padding", "shadow", "border"]) {
      expect(find(`frame-card-${card}`), card).toBeNull();
    }
  });

  it("picking a type turns the feature on: the three cards appear, collapsed, and the off-hint goes", async () => {
    let doc: OverrideDoc | undefined;
    await render({ onDocChange: (d) => (doc = d) });
    await click("frame-tab-wallpaper");
    expect(doc?.frameStyle?.background).toEqual({ type: "wallpaper", file: wallpaperFile(1) });
    expect(find("frame-off-hint")).toBeNull();
    for (const card of ["padding", "shadow", "border"]) {
      expect(attr(`frame-card-${card}-toggle`, "aria-expanded"), card).toBe("false");
      expect(find(`slider-${card === "padding" ? "padding" : card}`), card).toBeNull();
    }
  });

  it("a header click expands one card and leaves its neighbours closed; again collapses it", async () => {
    await render({ initialDoc: { frameStyle: defaultFrameStyle() } });
    expect(find("slider-padding")).toBeNull();
    await click("frame-card-padding-toggle");
    expect(attr("frame-card-padding-toggle", "aria-expanded")).toBe("true");
    expectOne("slider-padding");
    expect(attr("frame-card-shadow-toggle", "aria-expanded")).toBe("false");
    expect(find("slider-shadowBlur")).toBeNull();
    await click("frame-card-padding-toggle");
    expect(attr("frame-card-padding-toggle", "aria-expanded")).toBe("false");
    expect(find("slider-padding")).toBeNull();
  });

  it("every value is a slider AND a typed readout — the readout keeps NumberField's field testid", async () => {
    await render({ initialDoc: { frameStyle: defaultFrameStyle() } });
    await click("frame-card-padding-toggle");
    await click("frame-card-shadow-toggle");
    await click("frame-card-border-toggle");
    // ScreenArc defaults, shown in the reference design's units.
    expect(val("slider-padding")).toBe("5");
    expect(val("field-padding")).toBe("5");
    expect(val("slider-shadowBlur")).toBe("35");
    // Opacity is stored 0..1 and read as a percentage.
    expect(val("slider-shadowOpacity")).toBe("80");
    expect(val("field-shadowOpacity")).toBe("80");
    expect(val("slider-radius")).toBe("16");
    expectOne("frame-shadow-color-swatch");
    expectOne("frame-border-color-swatch");
  });

  it("each reset rewrites ONLY its own group — padding, shadow, border independently", async () => {
    let doc: OverrideDoc | undefined;
    await render({
      initialDoc: {
        frameStyle: {
          ...defaultFrameStyle(),
          background: { type: "wallpaper", file: wallpaperFile(1) },
          padding: 20,
          shadowBlur: 99,
          radius: 99,
        },
      },
      onDocChange: (d) => (doc = d),
    });
    await click("frame-card-padding-reset");
    expect(doc?.frameStyle?.padding).toBe(5);
    expect(doc?.frameStyle?.shadowBlur).toBe(99);
    expect(doc?.frameStyle?.radius).toBe(99);

    await click("frame-card-shadow-reset");
    expect(doc?.frameStyle?.shadowBlur).toBe(35);
    expect(doc?.frameStyle?.shadowOffsetY).toBe(15);
    expect(doc?.frameStyle?.padding).toBe(5);
    expect(doc?.frameStyle?.radius).toBe(99);

    await click("frame-card-border-reset");
    expect(doc?.frameStyle?.radius).toBe(16);
    expect(doc?.frameStyle?.borderWidth).toBe(4);
    expect(doc?.frameStyle?.borderColor).toBe("rgba(255, 255, 255, 0.2)");
    expect(doc?.frameStyle?.shadowBlur).toBe(35);
    // Every reset keeps the background alone.
    expect(doc?.frameStyle?.background).toEqual({ type: "wallpaper", file: wallpaperFile(1) });
  });

  it("the footer's Remove is the way back to a plain video: the key is deleted", async () => {
    let doc: OverrideDoc | undefined;
    await render({
      initialDoc: { frameStyle: defaultFrameStyle() },
      onDocChange: (d) => (doc = d),
    });
    expect(find("frame-remove")).not.toBeNull();
    await click("frame-remove");
    expect(doc && "frameStyle" in doc).toBe(false);
    expect(find("frame-card-padding")).toBeNull();
    expectOne("frame-off-hint");
  });

  it("each tab seeds its own background kind and shows that kind's controls", async () => {
    let doc: OverrideDoc | undefined;
    await render({ onDocChange: (d) => (doc = d) });
    await click("frame-tab-color");
    expect(doc?.frameStyle?.background).toEqual({ type: "color", color: "#ffffff" });
    expectOne("frame-bg-color-swatch");
    expect(find("frame-gradient-preview")).toBeNull();
    await click("frame-tab-gradient");
    expect(doc?.frameStyle?.background).toEqual({
      type: "gradient",
      start: "#6366f1",
      end: "#9ca9ff",
      direction: "to bottom",
    });
    expectOne("frame-gradient-preview");
    expectOne("frame-grad-direction");
    // A second tab replaces the kind in place; the frame values already
    // written by the first one survive.
    await click("frame-tab-wallpaper");
    expect(doc?.frameStyle?.background).toEqual({ type: "wallpaper", file: wallpaperFile(1) });
    expect(doc?.frameStyle?.padding).toBe(5);
    expect(find("frame-gradient-preview")).toBeNull();
  });

  it("a slider drag writes the value under its own coalesce key (one scrub, one undo step)", async () => {
    let doc: OverrideDoc | undefined;
    await render({
      initialDoc: { frameStyle: defaultFrameStyle() },
      onDocChange: (d) => (doc = d),
    });
    await click("frame-card-padding-toggle");
    const slider = expectOne("slider-padding") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(slider, "12.5");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(doc?.frameStyle?.padding).toBe(12.5);
  });
});
